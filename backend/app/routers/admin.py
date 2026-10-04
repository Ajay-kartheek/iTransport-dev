"""Transport office: set up buses, routes, students and users; watch today's trips."""

from __future__ import annotations

import secrets
from typing import Any

from fastapi import APIRouter, Depends, Query
from google.cloud import firestore
from google.cloud.firestore import FieldFilter

from .. import ai, audit, cache, push
from ..db import BUSES, DECLARATIONS, POINTS, ROUTES, STUDENTS, TRIPS, USERS, get_db
from ..deps import CurrentUser, require_admin
from ..errors import ApiError, bad_request, conflict, not_found
from ..schemas import (
    BusBody,
    RouteBody,
    SchoolSettingsBody,
    StudentBody,
    UserCreateBody,
    UserUpdateBody,
)
from ..security import generate_tracker_key
from ..services.daily import entries_on, generate_summary, get_summary
from ..services.school import (
    campuses_of,
    get_school,
    public_campus,
    route_campus_ids,
    save_school,
    student_campus_id,
)
from ..services.trips import (
    end_trip,
    get_doc,
    list_docs,
    natural_key,
    trip_id,
    trip_view,
    trips_on,
)
from ..services.users import create_user, public_user, reset_password
from ..timeutil import DIRECTIONS, default_direction, is_date_str, now_ms, today_str

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _by_id(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {item["id"]: item for item in items}


def _new_stop_id() -> str:
    return "s" + secrets.token_hex(4)


# ---------------------------------------------------------------- settings


def _settings_out(school: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in school.items() if k != "location"}
    out["campuses"] = [public_campus(c) for c in campuses_of(school)]
    return out


@router.get("/settings")
async def read_settings(user: CurrentUser = Depends(require_admin)) -> dict[str, Any]:
    return {"settings": _settings_out(await get_school())}


@router.put("/settings")
async def write_settings(
    body: SchoolSettingsBody, user: CurrentUser = Depends(require_admin)
) -> dict[str, Any]:
    current = await get_school()
    old = {c["id"]: c for c in campuses_of(current)}
    campuses: list[dict[str, Any]] = []
    for campus in body.campuses:
        known = campus.id in old and campus.id not in {c["id"] for c in campuses}
        campuses.append(
            {
                "id": campus.id if known else "c" + secrets.token_hex(3),
                "name": campus.name,
                "address": campus.address,
                "location": campus.location.model_dump(),
            }
        )
    removed = set(old) - {c["id"] for c in campuses}
    if removed:
        routes = [r for r in await list_docs(ROUTES) if removed & set(r.get("campusIds") or [])]
        students = [s for s in await list_docs(STUDENTS) if s.get("campusId") in removed]
        if routes or students:
            names = ", ".join(sorted(old[c].get("name", "") for c in removed))
            raise conflict(
                f"{names} is still used by {len(routes)} route(s) and {len(students)} "
                "student(s). Move them to another campus first."
            )
    values = body.model_dump(exclude={"campuses"}) | {"campuses": campuses, "location": None}
    school = await save_school(values)
    cache.invalidate("buses")
    await audit.record(user, "settings.updated", "settings", "school")
    return {"settings": _settings_out(school)}


# ---------------------------------------------------------------- buses


async def _running_trip(bus: dict[str, Any]) -> dict[str, Any] | None:
    """The trip this bus is running right now, if any."""
    trip = await get_doc(TRIPS, bus.get("activeTripId"))
    if trip and trip.get("status") == "in_progress":
        return trip
    today = today_str()
    for direction in DIRECTIONS:  # trips started before activeTripId existed
        trip = await get_doc(TRIPS, trip_id(today, direction, bus["id"]))
        if trip and trip.get("status") == "in_progress":
            return trip
    return None


async def _check_bus(body: BusBody, bus_id: str | None) -> None:
    buses = await list_docs(BUSES)
    if any(b["id"] != bus_id and b.get("number", "").lower() == body.number.lower() for b in buses):
        raise conflict(f"Bus {body.number} already exists.")
    if body.routeId:
        if not await get_doc(ROUTES, body.routeId):
            raise bad_request("That route no longer exists.")
        clash = next(
            (
                b
                for b in buses
                if b["id"] != bus_id
                and b.get("routeId") == body.routeId
                and b.get("active", True)
                and body.active
            ),
            None,
        )
        if clash:
            raise conflict(f"That route is already assigned to Bus {clash.get('number')}.")


@router.get("/buses")
async def list_buses(user: CurrentUser = Depends(require_admin)) -> dict[str, Any]:
    buses = await list_docs(BUSES)
    routes = _by_id(await list_docs(ROUTES))
    drivers = [u for u in await list_docs(USERS) if u.get("role") == "DRIVER"]
    out = []
    for bus in sorted(buses, key=lambda b: natural_key(b.get("number", ""))):
        route = routes.get(bus.get("routeId") or "")
        out.append(
            {
                "id": bus["id"],
                "number": bus.get("number", ""),
                "plate": bus.get("plate", ""),
                "capacity": bus.get("capacity"),
                "routeId": bus.get("routeId"),
                "routeName": route.get("name") if route else None,
                "active": bus.get("active", True),
                "trackerKey": bus.get("trackerKey", ""),
                "drivers": [
                    {"id": d["id"], "name": d.get("name", "")}
                    for d in drivers
                    if bus["id"] in (d.get("busIds") or [])
                ],
            }
        )
    return {"buses": out}


@router.post("/buses")
async def create_bus(body: BusBody, user: CurrentUser = Depends(require_admin)) -> dict[str, Any]:
    await _check_bus(body, None)
    ref = get_db().collection(BUSES).document()
    now = now_ms()
    await ref.set(
        {
            **body.model_dump(),
            "trackerKey": generate_tracker_key(),
            "createdAt": now,
            "updatedAt": now,
        }
    )
    cache.invalidate("buses")
    await audit.record(user, "bus.created", "bus", ref.id, {"number": body.number})
    return {"id": ref.id}


@router.put("/buses/{bus_id}")
async def update_bus(
    bus_id: str, body: BusBody, user: CurrentUser = Depends(require_admin)
) -> dict[str, Any]:
    bus = await get_doc(BUSES, bus_id)
    if not bus:
        raise not_found("Bus")
    await _check_bus(body, bus_id)
    if body.routeId != bus.get("routeId") and await _running_trip(bus):
        raise conflict("This bus is on a trip right now. Change its route after the trip ends.")
    await (
        get_db()
        .collection(BUSES)
        .document(bus_id)
        .update({**body.model_dump(), "updatedAt": now_ms()})
    )
    cache.invalidate("buses")
    await audit.record(user, "bus.updated", "bus", bus_id, {"number": body.number})
    return {"id": bus_id}


@router.delete("/buses/{bus_id}")
async def delete_bus(bus_id: str, user: CurrentUser = Depends(require_admin)) -> dict[str, Any]:
    bus = await get_doc(BUSES, bus_id)
    if not bus:
        raise not_found("Bus")
    if await _running_trip(bus):
        raise conflict("This bus is on a trip right now. End the trip first.")
    db = get_db()
    drivers = db.collection(USERS).where(filter=FieldFilter("busIds", "array_contains", bus_id))
    async for driver in drivers.stream():
        await driver.reference.update({"busIds": firestore.ArrayRemove([bus_id])})
    await db.collection(BUSES).document(bus_id).delete()
    cache.invalidate("buses")
    await audit.record(user, "bus.deleted", "bus", bus_id, {"number": bus.get("number")})
    return {"ok": True}


@router.post("/buses/{bus_id}/tracker-key")
async def rotate_tracker_key(
    bus_id: str, user: CurrentUser = Depends(require_admin)
) -> dict[str, Any]:
    if not await get_doc(BUSES, bus_id):
        raise not_found("Bus")
    key = generate_tracker_key()
    await get_db().collection(BUSES).document(bus_id).update({"trackerKey": key})
    cache.invalidate("buses")
    cache.invalidate("tracker:")
    await audit.record(user, "bus.tracker_key_rotated", "bus", bus_id)
    return {"trackerKey": key}


# ---------------------------------------------------------------- routes


@router.get("/routes")
async def list_routes(user: CurrentUser = Depends(require_admin)) -> dict[str, Any]:
    routes = await list_docs(ROUTES)
    buses = await list_docs(BUSES)
    students = [s for s in await list_docs(STUDENTS) if s.get("active", True)]
    school = await get_school()
    out = []
    for route in sorted(routes, key=lambda r: natural_key(r.get("name", ""))):
        riders = [s for s in students if s.get("routeId") == route["id"]]
        bus = next((b for b in buses if b.get("routeId") == route["id"]), None)
        out.append(
            {
                "id": route["id"],
                "name": route.get("name", ""),
                "campusIds": route_campus_ids(route, school),
                "bus": {"id": bus["id"], "number": bus.get("number", "")} if bus else None,
                "studentCount": len(riders),
                "stops": [
                    {
                        **stop,
                        "studentCount": sum(1 for s in riders if s.get("stopId") == stop["id"]),
                    }
                    for stop in route.get("stops") or []
                ],
            }
        )
    return {"routes": out}


async def _campus_ids_from(body: RouteBody) -> list[str]:
    known = {c["id"] for c in campuses_of(await get_school())}
    if any(cid not in known for cid in body.campusIds):
        raise bad_request("One of those campuses no longer exists.")
    return list(dict.fromkeys(body.campusIds))


def _stops_from(body: RouteBody, keep_ids: set[str]) -> list[dict[str, Any]]:
    stops, seen = [], set()
    for stop in body.stops:
        sid = stop.id if stop.id in keep_ids and stop.id not in seen else _new_stop_id()
        seen.add(sid)
        stops.append(
            {
                "id": sid,
                "name": stop.name,
                "address": stop.address,
                "lat": stop.lat,
                "lng": stop.lng,
            }
        )
    return stops


@router.post("/routes")
async def create_route(
    body: RouteBody, user: CurrentUser = Depends(require_admin)
) -> dict[str, Any]:
    campus_ids = await _campus_ids_from(body)
    ref = get_db().collection(ROUTES).document()
    now = now_ms()
    await ref.set(
        {
            "name": body.name,
            "stops": _stops_from(body, set()),
            "campusIds": campus_ids,
            "createdAt": now,
            "updatedAt": now,
        }
    )
    await audit.record(user, "route.created", "route", ref.id, {"name": body.name})
    return {"id": ref.id}


@router.put("/routes/{route_id}")
async def update_route(
    route_id: str, body: RouteBody, user: CurrentUser = Depends(require_admin)
) -> dict[str, Any]:
    route = await get_doc(ROUTES, route_id)
    if not route:
        raise not_found("Route")
    campus_ids = await _campus_ids_from(body)
    old = {s["id"]: s for s in route.get("stops") or []}
    stops = _stops_from(body, set(old))
    removed = set(old) - {s["id"] for s in stops}
    if removed:
        query = get_db().collection(STUDENTS).where(filter=FieldFilter("routeId", "==", route_id))
        stranded = [s async for s in query.stream() if (s.to_dict() or {}).get("stopId") in removed]
        if stranded:
            names = ", ".join(
                sorted({old[(s.to_dict() or {})["stopId"]]["name"] for s in stranded})
            )
            raise conflict(
                f"{len(stranded)} student{'s are' if len(stranded) > 1 else ' is'} still assigned "
                f"to {names}. Move them to another stop first."
            )
    await (
        get_db()
        .collection(ROUTES)
        .document(route_id)
        .update({"name": body.name, "stops": stops, "campusIds": campus_ids, "updatedAt": now_ms()})
    )
    await audit.record(
        user, "route.updated", "route", route_id, {"name": body.name, "stops": len(stops)}
    )
    return {"id": route_id, "stops": stops}


@router.delete("/routes/{route_id}")
async def delete_route(route_id: str, user: CurrentUser = Depends(require_admin)) -> dict[str, Any]:
    route = await get_doc(ROUTES, route_id)
    if not route:
        raise not_found("Route")
    if any(b.get("routeId") == route_id for b in await list_docs(BUSES)):
        raise conflict("A bus still uses this route. Change the bus's route first.")
    query = get_db().collection(STUDENTS).where(filter=FieldFilter("routeId", "==", route_id))
    if [s async for s in query.limit(1).stream()]:
        raise conflict("Students are still assigned to this route. Move them first.")
    await get_db().collection(ROUTES).document(route_id).delete()
    await audit.record(user, "route.deleted", "route", route_id, {"name": route.get("name")})
    return {"ok": True}


# ---------------------------------------------------------------- students


async def _check_student(body: StudentBody) -> None:
    if body.routeId:
        route = await get_doc(ROUTES, body.routeId)
        if not route:
            raise bad_request("That route no longer exists.")
        if body.stopId and body.stopId not in {s["id"] for s in route.get("stops") or []}:
            raise bad_request("Pick a stop that is on this route.")
        if body.campusId and body.campusId not in route_campus_ids(route, await get_school()):
            raise bad_request("Pick a campus this route's bus goes to.")
    elif body.stopId:
        raise bad_request("Choose a route before choosing a stop.")
    if body.parentIds:
        db = get_db()
        refs = [db.collection(USERS).document(pid) for pid in set(body.parentIds)]
        parents = [s async for s in db.get_all(refs)]
        if any(not s.exists or (s.to_dict() or {}).get("role") != "PARENT" for s in parents):
            raise bad_request("Only parent accounts can be linked to a student.")


@router.get("/students")
async def list_students(user: CurrentUser = Depends(require_admin)) -> dict[str, Any]:
    students = await list_docs(STUDENTS)
    routes = _by_id(await list_docs(ROUTES))
    parents = _by_id([u for u in await list_docs(USERS) if u.get("role") == "PARENT"])
    school = await get_school()
    campus_names = {c["id"]: c.get("name", "") for c in campuses_of(school)}
    out = []
    for s in sorted(students, key=lambda x: x.get("name", "").lower()):
        route = routes.get(s.get("routeId") or "")
        stop = next(
            (st for st in (route or {}).get("stops") or [] if st["id"] == s.get("stopId")), None
        )
        campus_id = student_campus_id(s, route_campus_ids(route, school)) if route else None
        out.append(
            {
                "id": s["id"],
                "name": s.get("name", ""),
                "grade": s.get("grade", ""),
                "routeId": s.get("routeId"),
                "routeName": route.get("name") if route else None,
                "stopId": s.get("stopId"),
                "stopName": stop["name"] if stop else None,
                "campusId": campus_id,
                "campusName": campus_names.get(campus_id or ""),
                "parentIds": s.get("parentIds") or [],
                "parents": [
                    {"id": pid, "name": parents[pid].get("name", "")}
                    for pid in s.get("parentIds") or []
                    if pid in parents
                ],
                "active": s.get("active", True),
            }
        )
    return {"students": out}


@router.post("/students")
async def create_student(
    body: StudentBody, user: CurrentUser = Depends(require_admin)
) -> dict[str, Any]:
    await _check_student(body)
    ref = get_db().collection(STUDENTS).document()
    now = now_ms()
    await ref.set({**body.model_dump(), "createdAt": now, "updatedAt": now})
    await audit.record(user, "student.created", "student", ref.id, {"name": body.name})
    return {"id": ref.id}


@router.put("/students/{student_id}")
async def update_student(
    student_id: str, body: StudentBody, user: CurrentUser = Depends(require_admin)
) -> dict[str, Any]:
    if not await get_doc(STUDENTS, student_id):
        raise not_found("Student")
    await _check_student(body)
    await (
        get_db()
        .collection(STUDENTS)
        .document(student_id)
        .update({**body.model_dump(), "updatedAt": now_ms()})
    )
    cache.invalidate(f"student:{student_id}")
    await audit.record(user, "student.updated", "student", student_id, {"name": body.name})
    return {"id": student_id}


@router.delete("/students/{student_id}")
async def delete_student(
    student_id: str, user: CurrentUser = Depends(require_admin)
) -> dict[str, Any]:
    student = await get_doc(STUDENTS, student_id)
    if not student:
        raise not_found("Student")
    await get_db().collection(STUDENTS).document(student_id).delete()
    cache.invalidate(f"student:{student_id}")
    await audit.record(
        user, "student.deleted", "student", student_id, {"name": student.get("name")}
    )
    return {"ok": True}


# ---------------------------------------------------------------- users


async def _check_bus_ids(role: str, bus_ids: list[str]) -> list[str]:
    if not bus_ids:
        return []
    if role != "DRIVER":
        raise bad_request("Only drivers can be assigned to buses.")
    known = {b["id"] for b in await list_docs(BUSES)}
    return sorted({b for b in bus_ids if b in known})  # quietly forget deleted buses


@router.get("/users")
async def list_users(user: CurrentUser = Depends(require_admin)) -> dict[str, Any]:
    users = await list_docs(USERS)
    students = await list_docs(STUDENTS)
    out = []
    for u in sorted(users, key=lambda x: (x.get("role", ""), x.get("name", "").lower())):
        item = public_user(u["id"], u)
        item["children"] = [
            {"id": s["id"], "name": s.get("name", "")}
            for s in students
            if u["id"] in (s.get("parentIds") or [])
        ]
        item["locked"] = int(u.get("lockedUntil") or 0) > now_ms()
        out.append(item)
    return {"users": out}


@router.post("/users")
async def add_user(
    body: UserCreateBody, user: CurrentUser = Depends(require_admin)
) -> dict[str, Any]:
    bus_ids = await _check_bus_ids(body.role, body.busIds)
    uid, temp = await create_user(
        name=body.name, username=body.username, role=body.role, mobile=body.mobile, bus_ids=bus_ids
    )
    await audit.record(
        user, "user.created", "user", uid, {"username": body.username, "role": body.role}
    )
    return {"id": uid, "username": body.username.strip().lower(), "tempPassword": temp}


@router.put("/users/{user_id}")
async def edit_user(
    user_id: str, body: UserUpdateBody, user: CurrentUser = Depends(require_admin)
) -> dict[str, Any]:
    target = await get_doc(USERS, user_id)
    if not target:
        raise not_found("User")
    if user_id == user.id and not body.active:
        raise bad_request("You can't turn off your own account.")
    bus_ids = await _check_bus_ids(target.get("role", ""), body.busIds)
    updates: dict[str, Any] = {
        "name": body.name,
        "mobile": body.mobile,
        "active": body.active,
        "busIds": bus_ids,
        "updatedAt": now_ms(),
    }
    turning_off = target.get("active", True) and not body.active
    if turning_off:  # old sessions must not come back if the account is re-enabled
        updates["tokenVersion"] = firestore.Increment(1)
    await get_db().collection(USERS).document(user_id).update(updates)
    if turning_off:
        await push.delete_user_subscriptions(user_id)
    await audit.record(user, "user.updated", "user", user_id, {"active": body.active})
    return {"id": user_id}


@router.post("/users/{user_id}/reset-password")
async def reset_user_password(
    user_id: str, user: CurrentUser = Depends(require_admin)
) -> dict[str, Any]:
    temp = await reset_password(user_id)
    await audit.record(user, "user.password_reset", "user", user_id)
    return {"id": user_id, "tempPassword": temp}


# ---------------------------------------------------------------- operations


@router.get("/live")
async def live(user: CurrentUser = Depends(require_admin)) -> dict[str, Any]:
    now = now_ms()
    today = today_str(now)
    school = await get_school()
    buses = [b for b in await list_docs(BUSES) if b.get("active", True)]
    routes = _by_id(await list_docs(ROUTES))
    todays = _by_id(await trips_on(today))
    fallback = default_direction(now)
    out = []
    for bus in sorted(buses, key=lambda b: natural_key(b.get("number", ""))):
        route = routes.get(bus.get("routeId") or "")
        trips = {d: todays.get(trip_id(today, d, bus["id"])) for d in DIRECTIONS}
        running = [d for d in DIRECTIONS if (trips[d] or {}).get("status") == "in_progress"]
        direction = running[0] if running else fallback
        view = trip_view(
            trips[direction],
            bus=bus,
            route=route,
            school=school,
            date=today,
            direction=direction,
            now=now,
        )
        out.append(
            {
                "id": bus["id"],
                "number": bus.get("number", ""),
                "plate": bus.get("plate", ""),
                "routeName": route.get("name") if route else None,
                "trips": {d: (trips[d] or {}).get("status", "scheduled") for d in DIRECTIONS},
                "trip": view,
            }
        )
    return {
        "now": now,
        "today": today,
        "school": {
            "name": school["name"],
            "campuses": [public_campus(c) for c in campuses_of(school)],
        },
        "buses": out,
    }


@router.get("/today")
async def today_counts(user: CurrentUser = Depends(require_admin)) -> dict[str, Any]:
    async def load() -> dict[str, Any]:
        today = today_str()
        students = [s for s in await list_docs(STUDENTS) if s.get("active", True)]
        query = get_db().collection(DECLARATIONS).where(filter=FieldFilter("date", "==", today))
        marks = {
            (d.get("studentId"), d.get("direction")): d.get("status")
            async for snap in query.stream()
            for d in [snap.to_dict() or {}]
        }
        buses = [b for b in await list_docs(BUSES) if b.get("active", True)]

        def counts(group: list[dict[str, Any]], direction: str) -> dict[str, int]:
            statuses = [marks.get((s["id"], direction), "none") for s in group]
            return {k: statuses.count(k) for k in ("riding", "absent", "none")}

        per_bus = []
        for bus in buses:
            group = [
                s for s in students if bus.get("routeId") and s.get("routeId") == bus["routeId"]
            ]
            per_bus.append(
                {
                    "busId": bus["id"],
                    **{d: counts(group, d) for d in DIRECTIONS},
                    "students": len(group),
                }
            )
        routed = [s for s in students if s.get("routeId")]
        return {
            "date": today,
            "students": len(routed),
            "totals": {d: counts(routed, d) for d in DIRECTIONS},
            "buses": per_bus,
        }

    return await cache.cached("admin-today", 15, load)


@router.get("/trips")
async def list_trips(
    date: str | None = Query(default=None), user: CurrentUser = Depends(require_admin)
) -> dict[str, Any]:
    day = date or today_str()
    if not is_date_str(day):
        raise bad_request("Use a date like 2026-10-05.")
    trips = sorted(await trips_on(day), key=lambda t: t.get("startedAt") or 0, reverse=True)
    return {
        "date": day,
        "trips": [
            {
                "id": t["id"],
                "busNumber": t.get("busNumber", ""),
                "routeName": t.get("routeName", ""),
                "direction": t.get("direction"),
                "status": t.get("status"),
                "driverName": t.get("driverName"),
                "startedAt": t.get("startedAt"),
                "endedAt": t.get("endedAt"),
                "endedBy": t.get("endedBy"),
                "schoolReachedAt": t.get("schoolReachedAt"),
                "pointCount": t.get("pointCount", 0),
                "stopsDone": sum(
                    1
                    for s in t.get("stops") or []
                    if (t.get("progress") or {}).get(s["id"], {}).get("arrivedAt")
                ),
                "stopsTotal": len(t.get("stops") or []),
            }
            for t in trips
        ],
    }


@router.post("/trips/{tid}/end")
async def force_end_trip(tid: str, user: CurrentUser = Depends(require_admin)) -> dict[str, Any]:
    trip = await end_trip(user, tid, as_admin=True)
    await audit.record(user, "trip.ended_by_admin", "trip", tid)
    return {"tripId": tid, "endedAt": trip.get("endedAt")}


@router.get("/trips/{tid}/path")
async def trip_path(tid: str, user: CurrentUser = Depends(require_admin)) -> dict[str, Any]:
    if not await get_doc(TRIPS, tid):
        raise not_found("Trip")
    query = get_db().collection(TRIPS).document(tid).collection(POINTS).order_by("at").limit(3000)
    points = [
        [d["lat"], d["lng"], d["at"]] async for s in query.stream() for d in [s.to_dict() or {}]
    ]
    return {"tripId": tid, "points": points}


@router.get("/audit")
async def audit_log(
    date: str | None = Query(default=None), user: CurrentUser = Depends(require_admin)
) -> dict[str, Any]:
    """Everything that happened on one school day (newest first)."""
    day = date or today_str()
    if not is_date_str(day):
        raise bad_request("Use a date like 2026-10-05.")
    return {"date": day, "entries": await entries_on(day)}


# ---------------------------------------------------------------- daily AI summary


@router.get("/summaries/{day}")
async def read_summary(day: str, user: CurrentUser = Depends(require_admin)) -> dict[str, Any]:
    if not is_date_str(day):
        raise bad_request("Use a date like 2026-10-05.")
    return {"summary": await get_summary(day), "enabled": ai.ai_enabled()}


@router.post("/summaries/{day}")
async def write_summary(day: str, user: CurrentUser = Depends(require_admin)) -> dict[str, Any]:
    if not is_date_str(day) or day > today_str():
        raise bad_request("Pick today or an earlier day.")
    if not ai.ai_enabled():
        raise ApiError(503, "ai_unavailable", "AI summaries aren't set up on this server.")
    try:
        summary = await generate_summary(day)
    except ApiError:
        raise
    except Exception as exc:
        raise ApiError(
            502, "ai_failed", "Couldn't write the summary just now. Please try again."
        ) from exc
    return {"summary": summary, "enabled": True}
