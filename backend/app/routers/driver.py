"""Driver views: pick a bus, see who is riding, start/end the trip, send location."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from .. import audit
from ..db import BUSES, ROUTES, TRIPS
from ..deps import CurrentUser, require_driver
from ..errors import conflict, forbidden, not_found
from ..geo import Fix
from ..schemas import Direction, LocationsBody, StartTripBody
from ..services.school import get_school
from ..services.trips import (
    all_buses,
    build_roster,
    end_trip,
    get_doc,
    ingest_fixes,
    natural_key,
    raise_if_wrong_bus,
    start_trip,
    travel_stops,
    trip_id,
    trip_view,
    trips_on,
)
from ..timeutil import DIRECTIONS, default_direction, now_ms, today_str

router = APIRouter(prefix="/api/driver", tags=["driver"])


async def _bus_and_route(user: CurrentUser, bus_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    bus = await get_doc(BUSES, bus_id)
    if not bus or not bus.get("active", True):
        raise not_found("Bus")
    raise_if_wrong_bus(user, bus_id)
    route = await get_doc(ROUTES, bus.get("routeId"))
    if not route:
        raise conflict(f"Bus {bus.get('number')} has no route yet. Ask the transport office.")
    return bus, route


@router.get("/home")
async def home(user: CurrentUser = Depends(require_driver)) -> dict[str, Any]:
    now = now_ms()
    today = today_str(now)
    buses = [b for b in await all_buses() if b.get("active", True)]
    if user.bus_ids:
        buses = [b for b in buses if b["id"] in user.bus_ids]
    todays = {t["id"]: t for t in await trips_on(today)}

    active = next(
        (
            t
            for t in todays.values()
            if t.get("driverId") == user.id and t.get("status") == "in_progress"
        ),
        None,
    )
    out = []
    for bus in sorted(buses, key=lambda b: natural_key(b.get("number", ""))):
        route = await get_doc(ROUTES, bus.get("routeId"))
        trips = {}
        for direction in DIRECTIONS:
            trip = todays.get(trip_id(today, direction, bus["id"]))
            trips[direction] = {
                "status": (trip or {}).get("status", "scheduled"),
                "driverName": (trip or {}).get("driverName"),
                "mine": (trip or {}).get("driverId") == user.id,
            }
        out.append(
            {
                "id": bus["id"],
                "number": bus.get("number", ""),
                "plate": bus.get("plate", ""),
                "routeName": (route or {}).get("name"),
                "stopCount": len((route or {}).get("stops") or []),
                "trips": trips,
            }
        )
    return {
        "today": today,
        "now": now,
        "defaultDirection": default_direction(now),
        "activeTrip": {
            "id": active["id"],
            "busId": active["busId"],
            "busNumber": active.get("busNumber", ""),
            "direction": active["direction"],
            "startedAt": active.get("startedAt"),
        }
        if active
        else None,
        "buses": out,
    }


@router.get("/buses/{bus_id}/roster")
async def roster(
    bus_id: str, direction: Direction, user: CurrentUser = Depends(require_driver)
) -> dict[str, Any]:
    bus, route = await _bus_and_route(user, bus_id)
    now = now_ms()
    today = today_str(now)
    school = await get_school()
    trip = await get_doc(TRIPS, trip_id(today, direction, bus_id))
    stops = (trip or {}).get("stops") or travel_stops(route, school, direction)
    view = trip_view(
        trip, bus=bus, route=route, school=school, date=today, direction=direction, now=now
    )
    return {
        "bus": {"id": bus["id"], "number": bus.get("number", ""), "plate": bus.get("plate", "")},
        "route": {"id": route["id"], "name": route.get("name", "")},
        "date": today,
        "direction": direction,
        "trip": view,
        "mine": (trip or {}).get("driverId") == user.id,
        "roster": await build_roster(route["id"], stops, today, direction),
        "now": now,
    }


@router.post("/trips/start")
async def start(body: StartTripBody, user: CurrentUser = Depends(require_driver)) -> dict[str, Any]:
    bus, route = await _bus_and_route(user, body.busId)
    trip, created = await start_trip(user, bus, route, body.direction)
    if created:
        await audit.record(user, "trip.started", "trip", trip["id"], {"bus": bus.get("number")})
    return {"tripId": trip["id"], "startedAt": trip["startedAt"]}


async def _own_trip(user: CurrentUser, tid: str) -> dict[str, Any]:
    trip = await get_doc(TRIPS, tid)
    if not trip:
        raise not_found("Trip")
    if trip.get("driverId") != user.id:
        raise forbidden("This trip belongs to another driver.")
    return trip


@router.get("/trips/{tid}")
async def trip_state(tid: str, user: CurrentUser = Depends(require_driver)) -> dict[str, Any]:
    trip = await _own_trip(user, tid)
    now = now_ms()
    bus = await get_doc(BUSES, trip["busId"]) or {
        "id": trip["busId"],
        "number": trip.get("busNumber"),
    }
    school = await get_school()
    view = trip_view(
        trip,
        bus=bus,
        route=None,
        school=school,
        date=trip["date"],
        direction=trip["direction"],
        now=now,
    )
    return {
        "trip": view,
        "roster": await build_roster(
            trip["routeId"], trip["stops"], trip["date"], trip["direction"]
        ),
        "now": now,
    }


@router.post("/trips/{tid}/locations")
async def locations(
    tid: str,
    body: LocationsBody,
    request: Request,
    user: CurrentUser = Depends(require_driver),
) -> dict[str, Any]:
    fixes = [
        Fix(lat=f.lat, lng=f.lng, at=f.at, accuracy=f.accuracy, speed=f.speed, heading=f.heading)
        for f in body.fixes
    ]
    return await ingest_fixes(tid, fixes, driver_id=user.id, http=request.app.state.http)


@router.post("/trips/{tid}/end")
async def end(tid: str, user: CurrentUser = Depends(require_driver)) -> dict[str, Any]:
    trip = await end_trip(user, tid)
    await audit.record(user, "trip.ended", "trip", tid)
    return {"tripId": tid, "endedAt": trip.get("endedAt")}
