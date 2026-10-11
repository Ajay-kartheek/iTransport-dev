"""Stop progress: which stops the bus has reached, passed, or still has ahead.

Every accepted position extends the bus's path. Whenever that path comes within
the arrival radius of a stop, the stop gets a *visit* (entered, closest, left).
Progress is then worked out from all visits together: the longest run of visits
that follows the stop order forward in time. Stops on that run were reached,
stops before its end that aren't on it were passed, and the rest are ahead.

Working from the whole path, instead of waiting for one stop at a time, means a
missed stop, a stop pinned off the road, or a gap in the signal never leaves a
trip stuck. An empty bus driving out past its stops to the start of a morning
route doesn't count them, because it passes them against the stop order.

A run counts from its first visit only if that is the trip's first stop;
otherwise it needs a second stop visited in order to back it up. Every stop a
run jumps over counts against it, since buses rarely skip stops: "drove past
stop 4 on the way out to stop 5" then beats "skipped stops 1 to 3".

If the bus clearly works through the stops in the opposite order, the order is
flipped for the rest of the trip. Afternoon trips flip on that alone; morning
trips flip only when the bus also stands still at those stops, since an empty
bus on its way out to the first pickup passes them in the same reversed order.

Everything here is pure and synchronous so it can be unit tested directly.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from .geo import Fix, distance_to, haversine_m

DEPART_HYSTERESIS_M = 40.0  # a visit ends once the bus is this far outside the radius
STILL_MPS = 1.5  # slower than this between two fixes inside the radius = standing still
STOPPED_MS = 20_000  # standing still this long at a stop means the bus stopped there
FLIP_STOPPED_STOPS = 3  # a morning trip flips only after stopping at this many stops
SKIP_COST = 0.6  # each stop a run jumps over counts against it (a bit more than half a visit)
LEFT_ORIGIN_M = 400.0  # moved this far from where it started = the bus has set off
MAX_SEGMENT_MS = 150_000  # longer gaps between fixes aren't treated as a straight drive
MAX_SEGMENT_M = 1_500.0
MAX_VISITS_PER_STOP = 6

# {"in": entered ms, "at": closest ms, "out": left ms | None, "d": closest metres,
#  "still": ms spent standing still inside the radius}
Visit = dict[str, Any]
Visits = dict[str, list[Visit]]


# ---------------------------------------------------------------- visits


def _metres(lat: float, lng: float, ref_lat: float, ref_lng: float) -> tuple[float, float]:
    """Local flat-earth offset in metres; plenty accurate within a few kilometres."""
    return (
        (lng - ref_lng) * 111_320.0 * math.cos(math.radians(ref_lat)),
        (lat - ref_lat) * 110_574.0,
    )


def _pass_by(
    stop: dict[str, Any], prev: Fix, fix: Fix, radius_m: float
) -> tuple[float, int, int | None, int | None]:
    """How the straight move prev -> fix passes a stop.

    Returns (closest distance, time of closest approach, time it entered the
    radius, time it left the radius). The last two are None when it never got
    inside, or (for leaving) when it is still inside at the end of the move.
    """
    slat, slng = float(stop["lat"]), float(stop["lng"])
    ax, ay = _metres(prev.lat, prev.lng, slat, slng)
    bx, by = _metres(fix.lat, fix.lng, slat, slng)
    dx, dy = bx - ax, by - ay
    length2 = dx * dx + dy * dy
    span = fix.at - prev.at

    def time_at(u: float) -> int:
        return int(prev.at + u * span)

    if length2 < 1e-6:  # standing still
        dist = math.hypot(bx, by)
        inside = dist <= radius_m
        return dist, fix.at, (prev.at if inside else None), None
    u = max(0.0, min(1.0, -(ax * dx + ay * dy) / length2))
    dist = math.hypot(ax + u * dx, ay + u * dy)
    if dist > radius_m:
        return dist, time_at(u), None, None
    b = ax * dx + ay * dy
    c = ax * ax + ay * ay - radius_m * radius_m
    root = math.sqrt(max(0.0, b * b - length2 * c))
    u_in = max(0.0, (-b - root) / length2)
    u_out = (-b + root) / length2
    return dist, time_at(u), time_at(u_in), (time_at(u_out) if u_out < 1.0 else None)


def record_visits(
    stops: list[dict[str, Any]],
    visits: Visits,
    prev: Fix | None,
    fix: Fix,
    radius_m: float,
) -> None:
    """Extend each stop's visits with the move from ``prev`` to ``fix`` (mutates ``visits``)."""
    straight = (
        prev is not None
        and fix.at - prev.at <= MAX_SEGMENT_MS
        and haversine_m(prev.lat, prev.lng, fix.lat, fix.lng) <= MAX_SEGMENT_M
    )
    for stop in stops:
        history = visits.get(stop["id"]) or []
        current = history[-1] if history and history[-1].get("out") is None else None
        end_dist = distance_to(fix, stop)
        if straight and prev is not None:
            dist, closest_at, entered_at, left_at = _pass_by(stop, prev, fix, radius_m)
        else:  # first fix, or after a long gap: judge by this position alone
            dist, closest_at, left_at = end_dist, fix.at, None
            entered_at = fix.at if end_dist <= radius_m else None

        if entered_at is not None:
            if current is None:
                current = {
                    "in": entered_at,
                    "at": closest_at,
                    "out": None,
                    "d": round(dist, 1),
                    "still": 0,
                }
                history.append(current)
            elif dist < current["d"]:
                current["at"], current["d"] = closest_at, round(dist, 1)
            if straight and prev is not None and end_dist <= radius_m:
                span = fix.at - prev.at
                moved = haversine_m(prev.lat, prev.lng, fix.lat, fix.lng)
                if span > 0 and moved / (span / 1000) < STILL_MPS:
                    current["still"] = int(current.get("still") or 0) + span
            if left_at is not None and end_dist > radius_m + DEPART_HYSTERESIS_M:
                current["out"] = left_at
        elif current is not None and end_dist > radius_m + DEPART_HYSTERESIS_M:
            current["out"] = prev.at if prev is not None else fix.at

        if history:
            visits[stop["id"]] = history[-MAX_VISITS_PER_STOP:]


# ---------------------------------------------------------------- the run of visits


@dataclass(frozen=True)
class _Step:
    index: int  # position of the stop in the trip order
    visit: Visit
    still: int  # ms standing still at the stop
    kind: str


def _steps(
    stops: list[dict[str, Any]],
    visits: Visits,
    *,
    fixed: set[str],
    direction: str,
) -> list[_Step]:
    steps = []
    for index, stop in enumerate(stops):
        if stop["id"] in fixed:
            continue
        for visit in visits.get(stop["id"]) or []:
            still = int(visit.get("still") or 0)
            if direction == "AM" and stop["kind"] == "school" and still < STOPPED_MS:
                continue  # a morning bus driving past its school mid-route hasn't arrived
            steps.append(_Step(index, visit, still, stop["kind"]))
    steps.sort(key=lambda s: (int(s.visit["at"]), s.index))
    return steps


def best_run(
    stops: list[dict[str, Any]],
    visits: Visits,
    *,
    fixed: set[str],
    direction: str,
) -> tuple[list[_Step], float]:
    """The best-supported run of visits that follows the stop order forward in time.

    Returns the run and its score: one point per visit, less ``SKIP_COST`` for
    every stop it jumps over. A run of one visit only counts when it is the
    trip's first stop (two stops visited in order are evidence on their own),
    and a morning campus can't start a run (a bus parked at school isn't
    arriving). Runs that don't score above zero don't count.
    """
    steps = _steps(stops, visits, fixed=fixed, direction=direction)
    first_open = next((i for i, s in enumerate(stops) if s["id"] not in fixed), len(stops))

    def strong(step: _Step) -> bool:
        return step.index == first_open and not (direction == "AM" and step.kind == "school")

    count = len(steps)
    length = [1] * count  # longest run ending at each visit
    has_stop = [s.kind == "stop" for s in steps]
    before: list[int | None] = [None] * count
    for k, step in enumerate(steps):
        best: tuple[int, int, int] | None = None
        for j in range(k):
            prior = steps[j]
            if prior.index >= step.index or int(prior.visit["at"]) > int(step.visit["at"]):
                continue
            if direction == "AM" and step.kind == "school" and not has_stop[j]:
                continue
            key = (length[j], int(prior.visit["at"]), prior.index)
            if best is None or key > best:
                best, before[k] = key, j
        if before[k] is not None:
            j = before[k]
            length[k] = length[j] + 1  # type: ignore[index]
            has_stop[k] = has_stop[k] or has_stop[j]  # type: ignore[index]

    def score(k: int) -> float:
        skipped = steps[k].index - first_open + 1 - length[k]
        return length[k] - SKIP_COST * skipped

    winner: int | None = None
    for k, step in enumerate(steps):
        if (before[k] is None and not strong(step)) or score(k) <= 0:
            continue
        key = (score(k), int(step.visit["at"]), step.index)
        if winner is None or key > (
            score(winner),
            int(steps[winner].visit["at"]),
            steps[winner].index,
        ):
            winner = k

    if winner is None:
        return [], 0.0
    total = score(winner)
    run: list[_Step] = []
    at: int | None = winner
    while at is not None:
        run.append(steps[at])
        at = before[at]
    return run[::-1], total


def flipped(stops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The same trip with its pickup/drop-off stops in the opposite order (campuses stay put)."""
    order = iter(list(reversed([s for s in stops if s["kind"] == "stop"])))
    return [next(order) if s["kind"] == "stop" else s for s in stops]


def _progress_from(
    stops: list[dict[str, Any]], run: list[_Step], fixed: dict[str, dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    progress: dict[str, dict[str, Any]] = {sid: dict(state) for sid, state in fixed.items()}
    on_run = {step.index: step.visit for step in run}
    last = run[-1].index if run else -1
    for index, stop in enumerate(stops):
        if stop["id"] in fixed:
            continue
        visit = on_run.get(index)
        if visit is not None:
            progress[stop["id"]] = {
                "arrivedAt": int(visit["in"]),
                "departedAt": visit.get("out"),
                "skipped": False,
            }
        elif index < last:
            progress[stop["id"]] = {"arrivedAt": None, "departedAt": None, "skipped": True}
    return progress


@dataclass(frozen=True)
class Resolution:
    stops: list[dict[str, Any]]  # the order the trip now follows
    progress: dict[str, dict[str, Any]]
    flipped: bool  # the order was just switched


def resolve(
    stops: list[dict[str, Any]],
    visits: Visits,
    *,
    direction: str,
    fixed: dict[str, dict[str, Any]],
) -> Resolution:
    """Work out progress from the visits, flipping the stop order if the bus clearly reversed it."""
    fixed_ids = set(fixed)
    run, score = best_run(stops, visits, fixed=fixed_ids, direction=direction)
    other = flipped(stops)
    if other != stops:
        other_run, other_score = best_run(other, visits, fixed=fixed_ids, direction=direction)
        stopped_at = sum(1 for s in other_run if s.kind == "stop" and s.still >= STOPPED_MS)
        confirmed = direction == "PM" or stopped_at >= FLIP_STOPPED_STOPS
        if len(other_run) >= 2 and other_score > score and confirmed:
            return Resolution(other, _progress_from(other, other_run, fixed), True)
    return Resolution(stops, _progress_from(stops, run, fixed), False)


def changes(
    before: dict[str, dict[str, Any]], after: dict[str, dict[str, Any]]
) -> list[tuple[str, str]]:
    """What changed between two progress maps: ("arrived" | "skipped" | "departed", stop id)."""
    events: list[tuple[str, str]] = []
    for sid, state in after.items():
        old = before.get(sid) or {}
        if state.get("arrivedAt") and not old.get("arrivedAt"):
            events.append(("arrived", sid))
        elif state.get("skipped") and not old.get("skipped"):
            events.append(("skipped", sid))
        if state.get("departedAt") and not old.get("departedAt"):
            events.append(("departed", sid))
    return events


def visits_from_progress(progress: dict[str, dict[str, Any]]) -> Visits:
    """Visits for a trip that started before visits were recorded."""
    return {
        sid: [
            {
                "in": state["arrivedAt"],
                "at": state["arrivedAt"],
                "out": state.get("departedAt"),
                "d": 0.0,
                "still": STOPPED_MS,  # it was counted as reached, so keep counting it
            }
        ]
        for sid, state in progress.items()
        if state.get("arrivedAt")
    }
