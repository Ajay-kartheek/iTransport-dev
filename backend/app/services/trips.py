"""Trips: rosters, start/end, location ingest, ETAs and parent alerts.

A trip is one bus run on one date in one direction ("AM" pickup to school,
"PM" school to drop-off). Its document id is ``{date}_{direction}_{busId}`` and
it only exists once a driver starts it; before that it is "scheduled".
"""

from __future__ import annotations

import asyncio
import copy
import logging
import re
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from google.cloud import firestore
from google.cloud.firestore import FieldFilter

from .. import cache, push
from ..config import get_settings
from ..db import BUSES, DECLARATIONS, POINTS, ROUTES, STUDENTS, TRIPS, USERS, get_db
from ..deps import CurrentUser
from ..errors import ApiError, conflict, forbidden, not_found
from ..eta import compute_etas
from ..geo import Fix, check_fix, current_stop_id, distance_to, haversine_m, is_stale, pending_stops
from ..progress import LEFT_ORIGIN_M, changes, record_visits, resolve, visits_from_progress
from ..timeutil import local_now, now_ms, today_str
from .school import campuses_of, get_school, route_campus_ids, student_campus_id

log = logging.getLogger("itransport.trips")

# Students ride every school day unless a parent marks them absent.
DEFAULT_PLAN = "riding"
ETA_REFRESH_MS = 45_000
SAME_DISTANCE_M = 300.0  # ends of a route closer to school than this apart: run as listed
POINT_RETENTION_DAYS = 30
MAX_FIXES_PER_REQUEST = 120
ALERT_TIMEOUT_S = 8.0


# ---------------------------------------------------------------- ids & reads


def trip_id(date: str, direction: str, bus_id: str) -> str:
    return f"{date}_{direction}_{bus_id}"


def declaration_id(date: str, direction: str, student_id: str) -> str:
    return f"{date}_{direction}_{student_id}"


async def get_doc(collection: str, doc_id: str | None) -> dict[str, Any] | None:
    if not doc_id or "/" in doc_id:
        return None
    snap = await get_db().collection(collection).document(doc_id).get()
    return {"id": snap.id, **(snap.to_dict() or {})} if snap.exists else None


async def list_docs(collection: str) -> list[dict[str, Any]]:
    return [
        {"id": snap.id, **(snap.to_dict() or {})}
        async for snap in get_db().collection(collection).stream()
    ]


async def students_on_route(route_id: str) -> list[dict[str, Any]]:
    query = get_db().collection(STUDENTS).where(filter=FieldFilter("routeId", "==", route_id))
    students = [{"id": s.id, **(s.to_dict() or {})} async for s in query.stream()]
    return [s for s in students if s.get("active", True)]


async def declarations_for(
    date: str, direction: str, student_ids: list[str]
) -> dict[str, dict[str, Any]]:
    if not student_ids:
        return {}
    db = get_db()
    refs = [
        db.collection(DECLARATIONS).document(declaration_id(date, direction, sid))
        for sid in student_ids
    ]
    found: dict[str, dict[str, Any]] = {}
    async for snap in db.get_all(refs):
        if snap.exists:
            data = snap.to_dict() or {}
            found[data["studentId"]] = data
    return found


async def trips_on(date: str) -> list[dict[str, Any]]:
    query = get_db().collection(TRIPS).where(filter=FieldFilter("date", "==", date))
    return [{"id": s.id, **(s.to_dict() or {})} async for s in query.stream()]


async def all_buses() -> list[dict[str, Any]]:
    return list(await cache.cached("buses", 10, lambda: list_docs(BUSES)))


async def bus_for_route(route_id: str | None) -> dict[str, Any] | None:
    if not route_id:
        return None
    matches = [
        b for b in await all_buses() if b.get("routeId") == route_id and b.get("active", True)
    ]
    return sorted(matches, key=lambda b: natural_key(b.get("number", "")))[0] if matches else None


def natural_key(text: str) -> list[Any]:
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", text)]


# ---------------------------------------------------------------- stops & views


def school_stop_id(campus_id: str) -> str:
    return f"school-{campus_id}"


def stops_reversed(
    route: dict[str, Any] | None, school: dict[str, Any], direction: str
) -> tuple[bool, bool]:
    """Whether a trip runs the route's stops against their listed order.

    Returns (reversed, automatic). The office can set it per trip direction;
    otherwise it follows the map: morning trips end at school, so they finish
    with the end of the route nearest the campus; afternoon trips start at
    school, so they begin there. When both ends are about as near (a loop),
    both trips run the stops as listed.
    """
    chosen = (route or {}).get("amReversed" if direction == "AM" else "pmReversed")
    if isinstance(chosen, bool):
        return chosen, False
    stops = (route or {}).get("stops") or []
    campuses = {c["id"]: c for c in campuses_of(school)}
    first_campus = next(iter(route_campus_ids(route, school)), None)
    if len(stops) < 2 or first_campus not in campuses:
        return False, True
    loc = campuses[first_campus]["location"]
    near_first = haversine_m(float(stops[0]["lat"]), float(stops[0]["lng"]), loc["lat"], loc["lng"])
    near_last = haversine_m(
        float(stops[-1]["lat"]), float(stops[-1]["lng"]), loc["lat"], loc["lng"]
    )
    if abs(near_first - near_last) < max(SAME_DISTANCE_M, 0.2 * max(near_first, near_last)):
        return False, True
    school_end_listed_first = near_first < near_last
    if direction == "AM":
        return school_end_listed_first, True
    return not school_end_listed_first, True


def travel_stops(
    route: dict[str, Any] | None, school: dict[str, Any], direction: str
) -> list[dict[str, Any]]:
    """Stops in the order the bus visits them.

    Morning: the pickups, then the route's campuses in order. Afternoon: the
    campuses in reverse (collecting students), then the drop-offs. Which way
    round the pickups run is decided by ``stops_reversed``.
    """
    stops = [
        {
            "id": s["id"],
            "name": s["name"],
            "address": s.get("address", ""),
            "lat": float(s["lat"]),
            "lng": float(s["lng"]),
            "kind": "stop",
        }
        for s in (route or {}).get("stops") or []
    ]
    campuses = {c["id"]: c for c in campuses_of(school)}
    campus_stops = [
        {
            "id": school_stop_id(cid),
            "name": campuses[cid].get("name") or "School",
            "address": campuses[cid].get("address", ""),
            "lat": float(campuses[cid]["location"]["lat"]),
            "lng": float(campuses[cid]["location"]["lng"]),
            "kind": "school",
            "campusId": cid,
        }
        for cid in route_campus_ids(route, school)
    ]
    if stops_reversed(route, school, direction)[0]:
        stops.reverse()
    if direction == "AM":
        return stops + campus_stops
    return list(reversed(campus_stops)) + stops


def campus_order(stops: list[dict[str, Any]], direction: str) -> list[str]:
    """The campus ids among a trip's stops, in morning order."""
    ids = [s["campusId"] for s in stops if s.get("kind") == "school" and s.get("campusId")]
    return ids if direction == "AM" else list(reversed(ids))


def _stop_state(state: dict[str, Any]) -> str:
    if state.get("skipped"):
        return "skipped"
    if state.get("departedAt"):
        return "departed"
    if state.get("arrivedAt"):
        return "arrived"
    return "pending"


def position_time(trip: dict[str, Any]) -> int | None:
    """When the latest position was true, clamped to when the server received it."""
    fix = trip.get("lastFix")
    if not fix:
        return None
    received = trip.get("lastFixReceivedAt") or fix["at"]
    return min(int(fix["at"]), int(received))


def trip_view(
    trip: dict[str, Any] | None,
    *,
    bus: dict[str, Any],
    route: dict[str, Any] | None,
    school: dict[str, Any],
    date: str,
    direction: str,
    now: int,
) -> dict[str, Any]:
    """The shared live shape of a trip for parents, drivers and admins."""
    if trip is None:
        stops = travel_stops(route, school, direction)
        return {
            "id": trip_id(date, direction, bus["id"]),
            "status": "scheduled",
            "date": date,
            "direction": direction,
            "busId": bus["id"],
            "busNumber": bus.get("number", ""),
            "routeName": (route or {}).get("name", ""),
            "driverName": None,
            "startedAt": None,
            "endedAt": None,
            "schoolReachedAt": None,
            "position": None,
            "positionAt": None,
            "stale": False,
            "etaSource": None,
            "etaAt": None,
            "polyline": None,
            "currentStopId": None,
            "setOffAt": None,
            "stopsFlippedAt": None,
            "nextStopId": stops[0]["id"] if stops else None,
            "stops": [
                {**s, "state": "pending", "arrivedAt": None, "departedAt": None, "eta": None}
                for s in stops
            ],
        }

    progress = trip.get("progress") or {}
    etas = trip.get("etas") or {}
    running = trip.get("status") == "in_progress"
    at = position_time(trip)
    stops_out = []
    for s in trip.get("stops") or []:
        state = progress.get(s["id"]) or {}
        status = _stop_state(state)
        stops_out.append(
            {
                **s,
                "state": status,
                "arrivedAt": state.get("arrivedAt"),
                "departedAt": state.get("departedAt"),
                "eta": etas.get(s["id"]) if running and status == "pending" else None,
            }
        )
    remaining = pending_stops(trip.get("stops") or [], progress)
    return {
        "id": trip["id"],
        "status": trip.get("status"),
        "date": trip.get("date"),
        "direction": trip.get("direction"),
        "busId": trip.get("busId"),
        "busNumber": trip.get("busNumber", ""),
        "routeName": trip.get("routeName", ""),
        "driverName": trip.get("driverName"),
        "startedAt": trip.get("startedAt"),
        "endedAt": trip.get("endedAt"),
        "schoolReachedAt": trip.get("schoolReachedAt"),
        "position": trip.get("lastFix") if running else None,
        "positionAt": at if running else None,
        "stale": running and is_stale(at, now),
        "etaSource": trip.get("etaSource") if running else None,
        "etaAt": trip.get("etaAt") if running else None,
        "polyline": trip.get("polyline") if running else None,
        "currentStopId": current_stop_id(trip.get("stops") or [], progress) if running else None,
        "setOffAt": trip.get("setOffAt"),
        "stopsFlippedAt": trip.get("stopsFlippedAt"),
        "nextStopId": remaining[0]["id"] if remaining and running else None,
        "stops": stops_out,
    }


async def load_trip_view(
    bus: dict[str, Any], date: str, direction: str, now: int
) -> dict[str, Any]:
    school = await get_school()
    trip = await get_doc(TRIPS, trip_id(date, direction, bus["id"]))
    route = await get_doc(ROUTES, bus.get("routeId")) if trip is None else None
    return trip_view(
        trip, bus=bus, route=route, school=school, date=date, direction=direction, now=now
    )


# ---------------------------------------------------------------- roster


async def build_roster(
    route_id: str, stops: list[dict[str, Any]], date: str, direction: str
) -> dict[str, Any]:
    """Students grouped by stop (in travel order) with Riding / Absent counts."""
    students = await students_on_route(route_id)
    decl = await declarations_for(date, direction, [s["id"] for s in students])
    campus_ids = campus_order(stops, direction)

    by_stop: dict[str, list[dict[str, Any]]] = {s["id"]: [] for s in stops}
    by_campus: dict[str, list[dict[str, Any]]] = {cid: [] for cid in campus_ids}
    unassigned: list[dict[str, Any]] = []
    for student in sorted(students, key=lambda s: s.get("name", "").lower()):
        entry = {
            "id": student["id"],
            "name": student.get("name", ""),
            "grade": student.get("grade", ""),
            "status": (decl.get(student["id"]) or {}).get("status", DEFAULT_PLAN),
        }
        by_stop.get(student.get("stopId") or "", unassigned).append(entry)
        campus_id = student_campus_id(student, campus_ids)
        if campus_id in by_campus:
            by_campus[campus_id].append(entry)

    def counts(entries: list[dict[str, Any]]) -> dict[str, int]:
        return {
            "riding": sum(1 for e in entries if e["status"] == "riding"),
            "absent": sum(1 for e in entries if e["status"] == "absent"),
        }

    stop_rows = [
        {
            "id": s["id"],
            "name": s["name"],
            "address": s.get("address", ""),
            "kind": s["kind"],
            "campusId": s.get("campusId"),
            "students": by_stop[s["id"]],
            # A campus row counts the students who attend that campus.
            "counts": counts(
                by_campus.get(s.get("campusId") or "", [])
                if s["kind"] == "school"
                else by_stop[s["id"]]
            ),
        }
        for s in stops
    ]
    everyone = [e for row in stop_rows for e in row["students"]] + unassigned
    return {"stops": stop_rows, "unassigned": unassigned, "totals": counts(everyone)}


# ---------------------------------------------------------------- start / end


async def start_trip(
    user: CurrentUser, bus: dict[str, Any], route: dict[str, Any], direction: str
) -> tuple[dict[str, Any], bool]:
    """Start (or resume, for the same driver) today's trip. Returns (trip, newly_started)."""
    date = today_str()
    school = await get_school()
    stops = travel_stops(route, school, direction)
    if not [s for s in stops if s["kind"] == "stop"]:
        raise conflict("This bus's route has no stops yet. Ask the transport office to add them.")

    tid = trip_id(date, direction, bus["id"])
    db = get_db()
    ref = db.collection(TRIPS).document(tid)
    driver_ref = db.collection(USERS).document(user.id)
    bus_ref = db.collection(BUSES).document(bus["id"])

    @firestore.async_transactional
    async def claim(transaction: firestore.AsyncTransaction) -> tuple[dict[str, Any], bool]:
        snap = await ref.get(transaction=transaction)
        driver_snap = await driver_ref.get(transaction=transaction)
        bus_snap = await bus_ref.get(transaction=transaction)
        if snap.exists:
            existing = {"id": snap.id, **(snap.to_dict() or {})}
            if existing.get("status") == "in_progress":
                if existing.get("driverId") == user.id:
                    return existing, False
                raise conflict(
                    f"{existing.get('driverName') or 'Another driver'} already started this trip.",
                    "trip_taken",
                )
            raise conflict("This trip was already completed today.", "trip_completed")
        # One running trip per driver and per bus: while a trip runs, both point at it.
        # Reading them in this transaction makes two simultaneous starts conflict.
        for holder, code in ((driver_snap, "driver_busy"), (bus_snap, "bus_busy")):
            other_id = (holder.to_dict() or {}).get("activeTripId")
            if not other_id or other_id == tid:
                continue
            other_snap = await db.collection(TRIPS).document(other_id).get(transaction=transaction)
            other = other_snap.to_dict() or {}
            if other_snap.exists and other.get("status") == "in_progress":
                if code == "driver_busy":
                    raise conflict(
                        f"You're already running Bus {other.get('busNumber')} "
                        f"({other.get('direction')}). End that trip first.",
                        code,
                    )
                raise conflict(
                    f"Bus {bus.get('number')} is already on its {other.get('direction')} trip.",
                    code,
                )
        now = now_ms()
        progress: dict[str, Any] = {}
        if stops and stops[0]["kind"] == "school":  # afternoon trips start at a campus
            progress[stops[0]["id"]] = {"arrivedAt": now, "departedAt": now, "skipped": False}
        trip = {
            "date": date,
            "direction": direction,
            "busId": bus["id"],
            "busNumber": bus.get("number", ""),
            "routeId": route["id"],
            "routeName": route.get("name", ""),
            "status": "in_progress",
            "driverId": user.id,
            "driverName": user.name,
            "startedAt": now,
            "endedAt": None,
            "endedBy": None,
            "schoolReachedAt": None,
            "stops": stops,
            "progress": progress,
            "visits": {},
            "setOffAt": None,
            "leftOriginAt": None,
            "stopsFlippedAt": None,
            "etas": {},
            "etaAt": 0,
            "etaSource": None,
            "polyline": None,
            "lastFix": None,
            "lastFixReceivedAt": None,
            "jumpStreak": 0,
            "pointCount": 0,
            "alerts": {},
        }
        transaction.set(ref, trip)
        transaction.update(driver_ref, {"activeTripId": tid})
        transaction.update(bus_ref, {"activeTripId": tid})
        return {"id": tid, **trip}, True

    trip, created = await claim(db.transaction())
    if created:
        await _with_timeout(_notify_trip_started(trip))
    return trip, created


async def complete_trip(tid: str, *, ended_by: str, driver_id: str | None = None) -> dict[str, Any]:
    """Mark a trip completed and release its driver and bus.

    With ``driver_id`` set, only that driver may end it (admins and the
    scheduled clean-up pass ``None``).
    """
    db = get_db()
    ref = db.collection(TRIPS).document(tid)
    radius = float((await get_school()).get("arrivalRadiusM") or 120)

    @firestore.async_transactional
    async def finish(
        transaction: firestore.AsyncTransaction,
    ) -> tuple[dict[str, Any], list[tuple[str, str]]]:
        snap = await ref.get(transaction=transaction)
        if not snap.exists:
            raise not_found("Trip")
        trip = {"id": snap.id, **(snap.to_dict() or {})}
        if trip.get("status") == "completed":
            return trip, []
        if driver_id is not None and trip.get("driverId") != driver_id:
            raise forbidden("Only the driver running this trip can end it.")
        holders = [
            db.collection(USERS).document(trip["driverId"]) if trip.get("driverId") else None,
            db.collection(BUSES).document(trip["busId"]) if trip.get("busId") else None,
        ]
        snaps = [await h.get(transaction=transaction) if h else None for h in holders]
        updates = {
            "status": "completed",
            "endedAt": now_ms(),
            "endedBy": ended_by,
            **_ended_at_school(trip, radius),
        }
        events = changes(trip.get("progress") or {}, updates.get("progress") or {})
        transaction.update(ref, updates)
        for holder, holder_snap in zip(holders, snaps, strict=True):
            holds_this_trip = (
                holder_snap is not None
                and holder_snap.exists
                and (holder_snap.to_dict() or {}).get("activeTripId") == tid
            )
            if holder and holds_this_trip:
                transaction.update(holder, {"activeTripId": None})
        trip.update(updates)
        return trip, events

    trip, events = await finish(db.transaction())
    if events:
        await _with_timeout(_campus_alerts(trip, events))
    return trip


def _ended_at_school(trip: dict[str, Any], radius: float) -> dict[str, Any]:
    """Ending a morning trip at a campus counts as arriving there.

    Drivers often end the trip the moment they pull in, before the bus has
    stood still long enough for the arrival to count on its own.
    """
    last = Fix.from_dict(trip.get("lastFix"))
    stops = trip.get("stops") or []
    progress = copy.deepcopy(trip.get("progress") or {})
    picked_up = any(
        (progress.get(s["id"]) or {}).get("arrivedAt") for s in stops if s["kind"] == "stop"
    )
    if trip.get("direction") != "AM" or last is None or not picked_up:
        return {}
    here = next(
        (
            i
            for i, s in enumerate(stops)
            if s["kind"] == "school"
            and not (progress.get(s["id"]) or {}).get("arrivedAt")
            and distance_to(last, s) <= radius
        ),
        None,
    )
    if here is None:
        return {}
    stop = stops[here]
    visit = next(
        (v for v in reversed((trip.get("visits") or {}).get(stop["id"]) or []) if not v.get("out")),
        None,
    )
    progress[stop["id"]] = {
        "arrivedAt": int(visit["in"]) if visit else last.at,
        "departedAt": None,
        "skipped": False,
    }
    for earlier in stops[:here]:
        if not (progress.get(earlier["id"]) or {}).get("arrivedAt"):
            progress[earlier["id"]] = {"arrivedAt": None, "departedAt": None, "skipped": True}
    reached = [
        int(progress[s["id"]]["arrivedAt"])
        for s in stops
        if s["kind"] == "school" and (progress.get(s["id"]) or {}).get("arrivedAt")
    ]
    updates: dict[str, Any] = {"progress": progress}
    if not trip.get("schoolReachedAt"):
        updates["schoolReachedAt"] = max(reached)
    return updates


def _fixed_progress(trip: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Stops settled when the trip started: an afternoon trip begins at its first campus."""
    stops = trip.get("stops") or []
    if trip.get("direction") != "PM" or not stops or stops[0]["kind"] != "school":
        return {}
    state = (trip.get("progress") or {}).get(stops[0]["id"])
    return {stops[0]["id"]: dict(state)} if state and state.get("arrivedAt") else {}


async def end_trip(user: CurrentUser, tid: str, *, as_admin: bool = False) -> dict[str, Any]:
    return await complete_trip(tid, ended_by=user.name, driver_id=None if as_admin else user.id)


# ---------------------------------------------------------------- location ingest


async def ingest_fixes(
    tid: str,
    fixes: list[Fix],
    *,
    driver_id: str | None,
    http: httpx.AsyncClient | None,
) -> dict[str, Any]:
    """Validate and apply a batch of positions to a running trip."""
    fixes = sorted(fixes, key=lambda f: f.at)[-MAX_FIXES_PER_REQUEST:]
    school = await get_school()
    radius = float(school.get("arrivalRadiusM") or 120)
    db = get_db()
    ref = db.collection(TRIPS).document(tid)
    now = now_ms()
    expire_at = datetime.now(UTC) + timedelta(days=POINT_RETENTION_DAYS)

    @firestore.async_transactional
    async def apply(
        transaction: firestore.AsyncTransaction,
    ) -> tuple[dict[str, Any], list[Fix], dict[str, int], list[tuple[str, str]]]:
        snap = await ref.get(transaction=transaction)
        if not snap.exists:
            raise not_found("Trip")
        trip = {"id": snap.id, **(snap.to_dict() or {})}
        if trip.get("status") != "in_progress":
            raise conflict("This trip is not running.", "trip_not_active")
        if driver_id is not None and trip.get("driverId") != driver_id:
            raise forbidden("This trip belongs to another driver.")

        prev = Fix.from_dict(trip.get("lastFix"))
        origin = Fix.from_dict(trip.get("originFix"))
        streak = int(trip.get("jumpStreak") or 0)
        old_progress = trip.get("progress") or {}
        visits = copy.deepcopy(trip.get("visits") or visits_from_progress(old_progress))
        left_origin_at = trip.get("leftOriginAt")
        accepted: list[Fix] = []
        rejected: dict[str, int] = {}
        for fix in fixes:
            reason = check_fix(
                prev, fix, now=now, started_at=int(trip["startedAt"]), jump_streak=streak
            )
            if reason:
                rejected[reason] = rejected.get(reason, 0) + 1
                if reason == "jump":
                    streak += 1
                continue
            streak = 0
            record_visits(trip["stops"], visits, prev, fix, radius)
            origin = origin or fix
            if left_origin_at is None and (
                haversine_m(origin.lat, origin.lng, fix.lat, fix.lng) >= LEFT_ORIGIN_M
            ):
                left_origin_at = fix.at
            prev = fix
            accepted.append(fix)

        updates: dict[str, Any] = {"jumpStreak": streak}
        events: list[tuple[str, str]] = []
        if accepted and prev is not None:
            fixed = _fixed_progress(trip)
            outcome = resolve(trip["stops"], visits, direction=trip["direction"], fixed=fixed)
            progress = outcome.progress
            events = changes(old_progress, progress)
            if not trip.get("originFix") and origin is not None:
                updates["originFix"] = origin.to_dict()
            updates |= {
                "lastFix": prev.to_dict(),
                "lastFixReceivedAt": now,
                "progress": progress,
                "visits": visits,
                "leftOriginAt": left_origin_at,
                "pointCount": int(trip.get("pointCount") or 0) + len(accepted),
            }
            if outcome.flipped:
                events.append(("flipped", ""))
                updates |= {"stops": outcome.stops, "stopsFlippedAt": now}
                log.info("Trip %s: the bus is running the stops in reverse; order switched", tid)
            if not trip.get("setOffAt"):
                # Under way once it has left where it started, or reached a stop on the way.
                reached = [
                    int(state["arrivedAt"])
                    for sid, state in progress.items()
                    if sid not in fixed and state.get("arrivedAt")
                ]
                moments = [m for m in [left_origin_at, *reached] if m is not None]
                if moments:
                    updates["setOffAt"] = min(moments)
            campus_states = [
                progress.get(stop["id"]) or {} for stop in trip["stops"] if stop["kind"] == "school"
            ]
            every_campus_done = bool(campus_states) and all(
                st.get("arrivedAt") or st.get("skipped") for st in campus_states
            )
            reached_campus = [st["arrivedAt"] for st in campus_states if st.get("arrivedAt")]
            if (
                trip.get("direction") == "AM"
                and every_campus_done
                and reached_campus
                and not trip.get("schoolReachedAt")
            ):
                updates["schoolReachedAt"] = max(reached_campus)
            for fix in accepted:
                transaction.set(
                    ref.collection(POINTS).document(), {**fix.to_dict(), "expireAt": expire_at}
                )
        if accepted or streak != int(trip.get("jumpStreak") or 0):
            transaction.update(ref, updates)
        trip.update(updates)
        return trip, accepted, rejected, events

    trip, accepted, rejected, events = await apply(db.transaction())

    if accepted:
        progressed = any(kind in ("arrived", "skipped", "flipped") for kind, _ in events)
        try:
            trip = await refresh_eta(trip, http, force=progressed) or trip
        except Exception:  # positions are saved; a failed ETA refresh must not lose alerts
            log.exception("ETA refresh failed for trip %s", tid)
        await _with_timeout(_handle_alerts(trip, events))

    remaining = pending_stops(trip.get("stops") or [], trip.get("progress") or {})
    next_stop = remaining[0] if remaining else None
    return {
        "now": now,
        "accepted": len(accepted),
        "rejected": rejected,
        "currentStopId": current_stop_id(trip.get("stops") or [], trip.get("progress") or {}),
        "nextStopId": next_stop["id"] if next_stop else None,
        "nextStopEta": (trip.get("etas") or {}).get(next_stop["id"]) if next_stop else None,
    }


async def refresh_eta(
    trip: dict[str, Any], http: httpx.AsyncClient | None, *, force: bool = False
) -> dict[str, Any] | None:
    """Recompute ETAs at most every 45 s per trip (immediately after reaching a stop)."""
    now = now_ms()
    if not force and now - int(trip.get("etaAt") or 0) < ETA_REFRESH_MS:
        return None
    db = get_db()
    ref = db.collection(TRIPS).document(trip["id"])

    @firestore.async_transactional
    async def claim(transaction: firestore.AsyncTransaction) -> dict[str, Any] | None:
        snap = await ref.get(transaction=transaction)
        fresh = {"id": snap.id, **(snap.to_dict() or {})} if snap.exists else None
        if not fresh or fresh.get("status") != "in_progress":
            return None
        if not force and now - int(fresh.get("etaAt") or 0) < ETA_REFRESH_MS:
            return None
        transaction.update(ref, {"etaAt": now})
        return fresh

    fresh = await claim(db.transaction())
    fix = Fix.from_dict((fresh or {}).get("lastFix"))
    if fresh is None or fix is None:
        return None
    remaining = pending_stops(fresh["stops"], fresh.get("progress") or {})
    result = await compute_etas(http, get_settings().maps_server_key, fix, remaining, now)
    updates = {
        "etas": result.etas,
        "etaSource": result.source,
        "polyline": result.polyline,
        "etaAt": now,
    }
    await ref.update(updates)
    fresh.update(updates)
    return fresh


# ---------------------------------------------------------------- alerts


def _clock(ms: int) -> str:
    return local_now(ms).strftime("%-I:%M %p")


async def _with_timeout(coro: Any) -> None:
    try:
        await asyncio.wait_for(coro, ALERT_TIMEOUT_S)
    except TimeoutError:
        log.warning("Sending alerts timed out")
    except Exception:
        log.exception("Sending alerts failed")


async def _claim_alerts(tid: str, keys: list[str]) -> list[str]:
    """Atomically mark alert keys as sent; returns only the keys this call claimed."""
    if not keys:
        return []
    db = get_db()
    ref = db.collection(TRIPS).document(tid)

    @firestore.async_transactional
    async def claim(transaction: firestore.AsyncTransaction) -> list[str]:
        snap = await ref.get(transaction=transaction)
        alerts = dict((snap.to_dict() or {}).get("alerts") or {})
        fresh = [k for k in keys if k not in alerts]
        if fresh:
            now = now_ms()
            alerts.update({k: now for k in fresh})
            transaction.update(ref, {"alerts": alerts})
        return fresh

    return await claim(db.transaction())


async def _parents_to_notify(
    trip: dict[str, Any], stop_ids: set[str] | None = None, campus_id: str | None = None
) -> dict[str, list[str]]:
    """Parent id -> child names, skipping children marked absent for this trip."""
    students = await students_on_route(trip["routeId"])
    if stop_ids is not None:
        students = [s for s in students if s.get("stopId") in stop_ids]
    if campus_id is not None:
        order = campus_order(trip.get("stops") or [], trip["direction"])
        students = [s for s in students if student_campus_id(s, order) == campus_id]
    decl = await declarations_for(trip["date"], trip["direction"], [s["id"] for s in students])
    parents: dict[str, list[str]] = {}
    for student in students:
        if (decl.get(student["id"]) or {}).get("status") == "absent":
            continue
        for pid in student.get("parentIds") or []:
            parents.setdefault(pid, []).append(student.get("name", ""))
    return parents


async def _notify_trip_started(trip: dict[str, Any]) -> None:
    if not await _claim_alerts(trip["id"], ["start"]):
        return
    parents = await _parents_to_notify(trip)
    bus = trip.get("busNumber", "")
    if trip["direction"] == "AM":
        title, body = (
            f"Bus {bus} is on its way",
            "Morning pickup has started. We'll alert you when it's close to your stop.",
        )
    else:
        # With two campuses the bus may still be collecting, so don't say it has "left school".
        title, body = (
            f"Bus {bus} has started the drop-off",
            "Track it live in iTransport. We'll alert you when it's close to your stop.",
        )
    await push.send_to_users(
        list(parents), {"title": title, "body": body, "tag": f"start-{trip['id']}", "url": "/"}
    )


async def _campus_alerts(trip: dict[str, Any], events: list[tuple[str, str]]) -> None:
    """Tell each campus's families when a morning bus reaches it."""
    if trip["direction"] != "AM":
        return
    bus = trip.get("busNumber", "")
    stops = {s["id"]: s for s in trip.get("stops") or []}
    for kind, stop_id in events:
        stop = stops.get(stop_id)
        if kind != "arrived" or not stop or stop["kind"] != "school":
            continue
        if not await _claim_alerts(trip["id"], [f"school_{stop_id}"]):
            continue
        parents = await _parents_to_notify(trip, campus_id=stop.get("campusId"))
        arrived = ((trip.get("progress") or {}).get(stop_id) or {}).get("arrivedAt") or now_ms()
        await push.send_to_users(
            list(parents),
            {
                "title": f"Bus {bus} reached {stop['name']}",
                "body": f"Arrived at {_clock(arrived)}.",
                "tag": f"school-{trip['id']}-{stop_id}",
                "url": "/",
            },
        )


async def _handle_alerts(trip: dict[str, Any], events: list[tuple[str, str]]) -> None:
    await _campus_alerts(trip, events)
    school = await get_school()
    now = now_ms()
    bus = trip.get("busNumber", "")
    stops = {s["id"]: s for s in trip.get("stops") or []}
    if not trip.get("setOffAt"):
        return  # still waiting where it started: an arrival time now would mislead parents
    window = int(school.get("approachMinutes") or 10) * 60_000
    etas = trip.get("etas") or {}
    due = [
        s
        for s in pending_stops(trip.get("stops") or [], trip.get("progress") or {})
        if s["kind"] == "stop" and etas.get(s["id"]) and etas[s["id"]] - now <= window
    ]
    claimed = await _claim_alerts(trip["id"], [f"approach_{s['id']}" for s in due])
    for key in claimed:
        stop = stops[key.removeprefix("approach_")]
        parents = await _parents_to_notify(trip, {stop["id"]})
        if not parents:
            continue
        eta = etas[stop["id"]]
        minutes = max(1, round((eta - now) / 60_000))
        purpose = "pickup" if trip["direction"] == "AM" else "drop-off"
        await push.send_to_users(
            list(parents),
            {
                "title": f"Bus {bus} is about {minutes} min away",
                "body": f"Reaching {stop['name']} around {_clock(eta)} for {purpose}.",
                "tag": f"approach-{trip['id']}",
                "url": "/",
            },
        )


def raise_if_wrong_bus(user: CurrentUser, bus_id: str) -> None:
    if user.bus_ids and bus_id not in user.bus_ids:
        raise ApiError(403, "forbidden", "You're not assigned to this bus.")
