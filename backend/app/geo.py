"""Location quality filters, stop progress (geofencing) and fallback ETAs.

Everything here is pure and synchronous so it can be unit tested directly.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

EARTH_RADIUS_M = 6_371_000.0

MAX_ACCURACY_M = 100.0  # fixes less precise than this are dropped
MAX_SPEED_MPS = 33.4  # 120 km/h; faster implied movement between fixes is a GPS jump
MAX_FUTURE_MS = 120_000  # tolerate small device clock skew
JUMP_STREAK_LIMIT = 3  # after this many consecutive "jumps", trust the new position
DEPART_HYSTERESIS_M = 40.0
ARRIVAL_WINDOW = 3  # the next stop and the two after it
CONFIRM_DWELL_MS = 20_000  # a stop reached out of order must be confirmed by staying near it
MOVED_FROM_START_M = 400.0  # until then, only the next stop can be reached
STALE_AFTER_MS = 120_000  # no good fix for 2 minutes -> location is "unavailable"

# Fallback ETA model, used only when the Routes API is unavailable.
FALLBACK_SPEED_MPS = 22 / 3.6
FALLBACK_DETOUR = 1.35
DWELL_MS = 45_000


@dataclass(frozen=True)
class Fix:
    lat: float
    lng: float
    at: int  # epoch ms, device time
    accuracy: float  # metres
    speed: float | None = None  # m/s
    heading: float | None = None  # degrees from north

    def to_dict(self) -> dict[str, Any]:
        return {
            "lat": self.lat,
            "lng": self.lng,
            "at": self.at,
            "accuracy": self.accuracy,
            "speed": self.speed,
            "heading": self.heading,
        }

    @staticmethod
    def from_dict(d: dict[str, Any] | None) -> Fix | None:
        if not d:
            return None
        return Fix(
            lat=float(d["lat"]),
            lng=float(d["lng"]),
            at=int(d["at"]),
            accuracy=float(d.get("accuracy") or 0),
            speed=d.get("speed"),
            heading=d.get("heading"),
        )


def haversine_m(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = p2 - p1
    dl = math.radians(b_lng - a_lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


def distance_to(fix: Fix, stop: dict[str, Any]) -> float:
    return haversine_m(fix.lat, fix.lng, float(stop["lat"]), float(stop["lng"]))


def check_fix(
    prev: Fix | None, fix: Fix, *, now: int, started_at: int, jump_streak: int
) -> str | None:
    """Return why a fix must be rejected, or None to accept it."""
    if not (-90 <= fix.lat <= 90 and -180 <= fix.lng <= 180) or (fix.lat == 0 and fix.lng == 0):
        return "invalid"
    if fix.accuracy <= 0 or fix.accuracy > MAX_ACCURACY_M:
        return "inaccurate"
    if fix.at > now + MAX_FUTURE_MS:
        return "future"
    if fix.at < started_at - 60_000:
        return "before_start"
    if prev is None:
        return None
    if fix.at <= prev.at:
        return "out_of_order"
    seconds = (fix.at - prev.at) / 1000
    # Give each fix the benefit of its own error radius before calling it a jump.
    moved = max(
        0.0, haversine_m(prev.lat, prev.lng, fix.lat, fix.lng) - prev.accuracy - fix.accuracy
    )
    if moved / seconds > MAX_SPEED_MPS and jump_streak + 1 < JUMP_STREAK_LIMIT:
        return "jump"
    return None


def _resolved(state: dict[str, Any] | None) -> bool:
    return bool(state and (state.get("arrivedAt") or state.get("skipped")))


def advance_progress(
    stops: list[dict[str, Any]],
    progress: dict[str, dict[str, Any]],
    fix: Fix,
    radius_m: float,
    *,
    origin: Fix | None,
) -> list[tuple[str, str]]:
    """Update stop progress for one accepted fix (mutates ``progress``).

    Returns events in order: ("departed" | "skipped" | "arrived", stop_id).

    Only the next stop and the two after it can be reached. The next stop counts
    as soon as the bus is inside its radius; a stop further ahead must also be
    confirmed by staying near it for a while, and only once the bus has left
    where the trip started (buses often start parked next to some other stop).
    Reaching a stop marks the pending stops before it as passed ("skipped").
    A campus that comes after the pickups (morning trips) only counts once a
    pickup has happened, so a bus that starts the morning parked at school
    doesn't "arrive" at once. Campuses before the drop-offs (afternoon trips,
    which may collect from two campuses) count normally.
    """
    events: list[tuple[str, str]] = []

    for stop in stops:
        state = progress.get(stop["id"])
        if (
            state
            and state.get("arrivedAt")
            and not state.get("departedAt")
            and distance_to(fix, stop) > radius_m + DEPART_HYSTERESIS_M
        ):
            state["departedAt"] = fix.at
            events.append(("departed", stop["id"]))

    pending = [i for i, stop in enumerate(stops) if not _resolved(progress.get(stop["id"]))]
    first_pickup = next((i for i, stop in enumerate(stops) if stop["kind"] == "stop"), None)
    picked_up = any(
        (progress.get(stop["id"]) or {}).get("arrivedAt")
        for stop in stops
        if stop["kind"] == "stop"
    )
    left_start = (
        picked_up
        or origin is None
        or haversine_m(origin.lat, origin.lng, fix.lat, fix.lng) > MOVED_FROM_START_M
    )

    for rank, index in enumerate(pending[:ARRIVAL_WINDOW]):
        stop = stops[index]
        state = progress.setdefault(stop["id"], {})
        if distance_to(fix, stop) > radius_m:
            state.pop("nearSince", None)
            continue
        after_pickups = first_pickup is not None and index > first_pickup
        if stop["kind"] == "school" and after_pickups and not picked_up:
            continue
        arrived_at = fix.at
        if rank > 0:
            if not left_start:
                continue
            since = state.setdefault("nearSince", fix.at)
            if fix.at - since < CONFIRM_DWELL_MS:
                continue
            arrived_at = since
        for prior in pending[:rank]:
            prior_state = progress.setdefault(stops[prior]["id"], {})
            prior_state.pop("nearSince", None)
            prior_state["skipped"] = True
            events.append(("skipped", stops[prior]["id"]))
        progress[stop["id"]] = {"arrivedAt": arrived_at, "departedAt": None, "skipped": False}
        events.append(("arrived", stop["id"]))
        break

    return events


def pending_stops(
    stops: list[dict[str, Any]], progress: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    """Stops the bus has not reached or passed yet, in travel order."""
    out = []
    for stop in stops:
        state = progress.get(stop["id"]) or {}
        if not state.get("arrivedAt") and not state.get("skipped"):
            out.append(stop)
    return out


def current_stop_id(stops: list[dict[str, Any]], progress: dict[str, dict[str, Any]]) -> str | None:
    """The stop the bus is standing at right now, if any."""
    for stop in reversed(stops):
        state = progress.get(stop["id"]) or {}
        if state.get("arrivedAt") and not state.get("departedAt"):
            return stop["id"]
    return None


def estimate_etas(
    origin: tuple[float, float], remaining: list[dict[str, Any]], start_ms: int
) -> dict[str, int]:
    """Rough ETAs from straight-line distance; only a fallback for the Routes API."""
    etas: dict[str, int] = {}
    t = start_ms
    lat, lng = origin
    for i, stop in enumerate(remaining):
        meters = haversine_m(lat, lng, float(stop["lat"]), float(stop["lng"])) * FALLBACK_DETOUR
        t += int(meters / FALLBACK_SPEED_MPS * 1000)
        if i > 0:
            t += DWELL_MS
        etas[stop["id"]] = t
        lat, lng = float(stop["lat"]), float(stop["lng"])
    return etas


def is_stale(last_at: int | None, now: int) -> bool:
    """A position older than two minutes. No position yet is "waiting", not stale."""
    return last_at is not None and now - last_at > STALE_AFTER_MS
