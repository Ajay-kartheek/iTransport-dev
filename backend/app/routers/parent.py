"""Parent views: children, live bus, and Riding/Absent plans."""

from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, Depends
from google.cloud.firestore import FieldFilter

from .. import audit, cache
from ..db import DECLARATIONS, ROUTES, STUDENTS, TRIPS, get_db
from ..deps import CurrentUser, require_parent
from ..errors import bad_request, conflict, not_found
from ..schemas import DeclarationBody, Direction
from ..services.school import (
    campuses_of,
    get_school,
    is_service_day,
    public_school,
    route_campus_ids,
    student_campus_id,
    trip_cutoff_ms,
    upcoming_service_days,
)
from ..services.trips import (
    bus_for_route,
    campus_order,
    declaration_id,
    get_doc,
    school_stop_id,
    trip_id,
    trip_view,
)
from ..timeutil import (
    DIRECTIONS,
    add_days,
    day_label,
    default_direction,
    local_now,
    now_ms,
    today_str,
)

router = APIRouter(prefix="/api/parent", tags=["parent"])

PLAN_DAYS = 7
MAX_DAYS_AHEAD = 13


async def _children(parent_id: str) -> list[dict[str, Any]]:
    query = (
        get_db()
        .collection(STUDENTS)
        .where(filter=FieldFilter("parentIds", "array_contains", parent_id))
    )
    kids = [{"id": s.id, **(s.to_dict() or {})} async for s in query.stream()]
    return sorted((k for k in kids if k.get("active", True)), key=lambda k: k.get("name", ""))


async def _own_child(user: CurrentUser, student_id: str) -> dict[str, Any]:
    student = await cache.cached(f"student:{student_id}", 15, lambda: get_doc(STUDENTS, student_id))
    if not student or user.id not in (student.get("parentIds") or []):
        raise not_found("Child")
    return student


async def _trip_doc(tid: str) -> dict[str, Any] | None:
    # Many parents poll the same trip; a 2 s cache per instance keeps reads low.
    return await cache.cached(f"trip:{tid}", 2, lambda: get_doc(TRIPS, tid))


@router.get("/home")
async def home(user: CurrentUser = Depends(require_parent)) -> dict[str, Any]:
    school = await get_school()
    now = now_ms()
    today = today_str(now)
    days = upcoming_service_days(school, today, PLAN_DAYS)
    db = get_db()

    children_out = []
    for child in await _children(user.id):
        route = await get_doc(ROUTES, child.get("routeId"))
        bus = await bus_for_route(child.get("routeId"))
        stop = next(
            (s for s in (route or {}).get("stops") or [] if s["id"] == child.get("stopId")), None
        )
        campus_id = student_campus_id(child, route_campus_ids(route, school)) if route else None
        campus = next((c for c in campuses_of(school) if c["id"] == campus_id), None)

        refs = [
            db.collection(DECLARATIONS).document(declaration_id(d, direction, child["id"]))
            for d in days
            for direction in DIRECTIONS
        ]
        marks: dict[str, str] = {}
        async for snap in db.get_all(refs):
            if snap.exists:
                data = snap.to_dict() or {}
                marks[f"{data['date']}_{data['direction']}"] = data["status"]

        trips_today: dict[str, dict[str, Any]] = {}
        for direction in DIRECTIONS:
            trip = await _trip_doc(trip_id(today, direction, bus["id"])) if bus else None
            trips_today[direction] = {
                "status": (trip or {}).get("status", "scheduled") if bus else "none",
                "startedAt": (trip or {}).get("startedAt"),
                "endedAt": (trip or {}).get("endedAt"),
            }

        plan = []
        for d in days:
            slots = {}
            for direction in DIRECTIONS:
                cutoff = trip_cutoff_ms(school, d, direction)
                started = d == today and trips_today[direction]["status"] in (
                    "in_progress",
                    "completed",
                )
                slots[direction] = {
                    "status": marks.get(f"{d}_{direction}"),
                    "cutoffAt": cutoff,
                    "locked": now >= cutoff or started,
                }
            plan.append({"date": d, **slots})

        children_out.append(
            {
                "id": child["id"],
                "name": child.get("name", ""),
                "grade": child.get("grade", ""),
                "bus": {
                    "id": bus["id"],
                    "number": bus.get("number", ""),
                    "plate": bus.get("plate", ""),
                }
                if bus
                else None,
                "route": {"id": route["id"], "name": route.get("name", "")} if route else None,
                "stop": {
                    "id": stop["id"],
                    "name": stop["name"],
                    "address": stop.get("address", ""),
                    "lat": stop["lat"],
                    "lng": stop["lng"],
                }
                if stop
                else None,
                "campus": {"id": campus["id"], "name": campus["name"]} if campus else None,
                "trips": trips_today,
                "plan": plan,
            }
        )

    return {
        "school": public_school(school),
        "today": today,
        "now": now,
        "defaultDirection": default_direction(now),
        "days": [
            {
                "date": d,
                "label": day_label(d, today),
                "weekday": date.fromisoformat(d).strftime("%a"),
                "dayOfMonth": date.fromisoformat(d).day,
            }
            for d in days
        ],
        "children": children_out,
    }


@router.get("/children/{student_id}/live")
async def live(
    student_id: str,
    direction: Direction | None = None,
    user: CurrentUser = Depends(require_parent),
) -> dict[str, Any]:
    child = await _own_child(user, student_id)
    now = now_ms()
    today = today_str(now)
    bus = await bus_for_route(child.get("routeId"))
    if not bus:
        return {"trip": None, "myStopId": child.get("stopId"), "myCampusStopId": None, "now": now}

    trips = {d: await _trip_doc(trip_id(today, d, bus["id"])) for d in DIRECTIONS}
    if direction is None:
        running = [d for d in DIRECTIONS if (trips[d] or {}).get("status") == "in_progress"]
        direction = running[0] if running else default_direction(now)

    school = await get_school()
    trip = trips[direction]
    if trip and trip.get("routeId") != child.get("routeId"):
        trip = None  # the bus has since moved to another route; its trip isn't this child's
    route = None if trip else await get_doc(ROUTES, bus.get("routeId"))
    view = trip_view(
        trip, bus=bus, route=route, school=school, date=today, direction=direction, now=now
    )
    mark = await get_doc(DECLARATIONS, declaration_id(today, direction, student_id))
    my_campus = student_campus_id(child, campus_order(view["stops"], direction))
    return {
        "trip": view,
        "myStopId": child.get("stopId"),
        "myCampusStopId": school_stop_id(my_campus) if my_campus else None,
        "declaration": (mark or {}).get("status"),
        "now": now,
    }


@router.put("/declarations")
async def declare(
    body: DeclarationBody, user: CurrentUser = Depends(require_parent)
) -> dict[str, Any]:
    child = await _own_child(user, body.studentId)
    school = await get_school()
    now = now_ms()
    today = today_str(now)
    if body.date < today or body.date > add_days(today, MAX_DAYS_AHEAD):
        raise bad_request("You can plan up to two weeks ahead.")
    if not is_service_day(school, body.date):
        raise bad_request("There's no school bus on this day.")
    cutoff = trip_cutoff_ms(school, body.date, body.direction)
    if now >= cutoff:
        closes = local_now(cutoff).strftime("%-I:%M %p")
        raise conflict(
            f"Changes for this trip closed at {closes}. Please call the transport office.",
            "cutoff_passed",
        )
    if body.date == today:
        bus = await bus_for_route(child.get("routeId"))
        trip = await get_doc(TRIPS, trip_id(today, body.direction, bus["id"])) if bus else None
        if trip and trip.get("status") != "scheduled":
            raise conflict("The bus has already started this trip.", "trip_started")

    did = declaration_id(body.date, body.direction, body.studentId)
    await (
        get_db()
        .collection(DECLARATIONS)
        .document(did)
        .set(
            {
                "date": body.date,
                "direction": body.direction,
                "studentId": body.studentId,
                "status": body.status,
                "byUserId": user.id,
                "byName": user.name,
                "at": now,
            }
        )
    )
    await audit.record(
        user,
        "declaration.set",
        "student",
        body.studentId,
        {"date": body.date, "direction": body.direction, "status": body.status},
    )
    return {
        "studentId": body.studentId,
        "date": body.date,
        "direction": body.direction,
        "status": body.status,
        "at": now,
    }
