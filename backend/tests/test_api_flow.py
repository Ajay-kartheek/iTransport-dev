"""End-to-end API flow against the Firestore emulator.

Admin sets up a route, bus, parent, driver and child; the parent marks the
child as riding; the driver starts the trip, streams positions past the stops
and ends the trip; the parent follows along.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
import pytest

from app import cache
from app.services.users import create_user
from app.timeutil import now_ms, today_str

from .conftest import make_client

pytestmark = pytest.mark.asyncio

STOPS = [
    {"name": "Anna Nagar Tower", "address": "2nd Ave", "lat": 13.0850, "lng": 80.2101},
    {"name": "Thirumangalam", "address": "100 Feet Rd", "lat": 13.0950, "lng": 80.2101},
    {"name": "Mogappair East", "address": "Main Rd", "lat": 13.1050, "lng": 80.2101},
]
SCHOOL = {"lat": 13.1150, "lng": 80.2101}


async def sign_in(client: httpx.AsyncClient, username: str, password: str, new: str) -> None:
    r = await client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["mustChangePassword"] is True
    r = await client.post(
        "/api/auth/change-password", json={"currentPassword": password, "newPassword": new}
    )
    assert r.status_code == 200, r.text


async def setup_school(admin: httpx.AsyncClient) -> dict[str, Any]:
    r = await admin.put(
        "/api/admin/settings",
        json={
            "name": "Einstein Test School",
            "address": "School Rd",
            "campuses": [{"name": "Main Campus", "address": "School Rd", "location": SCHOOL}],
            "amCutoff": "23:58",
            "pmCutoff": "23:59",
            "approachMinutes": 10,
            "arrivalRadiusM": 120,
            "serviceDays": [1, 2, 3, 4, 5, 6, 7],
            "holidays": [],
        },
    )
    assert r.status_code == 200, r.text

    r = await admin.post("/api/admin/routes", json={"name": "Route 1", "stops": STOPS})
    assert r.status_code == 200, r.text
    route_id = r.json()["id"]
    route = next(
        x for x in (await admin.get("/api/admin/routes")).json()["routes"] if x["id"] == route_id
    )
    stop_ids = [s["id"] for s in route["stops"]]

    r = await admin.post(
        "/api/admin/buses", json={"number": "12", "plate": "TN 01 AB 1234", "routeId": route_id}
    )
    assert r.status_code == 200, r.text
    bus_id = r.json()["id"]

    r = await admin.post(
        "/api/admin/users", json={"name": "Priya", "username": "priya", "role": "PARENT"}
    )
    assert r.status_code == 200, r.text
    parent = r.json()
    r = await admin.post(
        "/api/admin/users",
        json={"name": "Ravi", "username": "ravi", "role": "DRIVER", "busIds": [bus_id]},
    )
    assert r.status_code == 200, r.text
    driver = r.json()

    r = await admin.post(
        "/api/admin/students",
        json={
            "name": "Aarav Kumar",
            "grade": "4B",
            "routeId": route_id,
            "stopId": stop_ids[1],
            "parentIds": [parent["id"]],
        },
    )
    assert r.status_code == 200, r.text
    return {
        "route_id": route_id,
        "stop_ids": stop_ids,
        "bus_id": bus_id,
        "parent": parent,
        "driver": driver,
        "student_id": r.json()["id"],
    }


def fixes_between(lat_from: float, lat_to: float, start_ms: int, steps: int) -> list[dict]:
    return [
        {
            "lat": lat_from + (lat_to - lat_from) * i / steps,
            "lng": 80.2101,
            "accuracy": 8,
            "at": start_ms + i * 15_000,
            "speed": 7.5,
            "heading": 0,
        }
        for i in range(1, steps + 1)
    ]


async def test_full_trip_flow(api: httpx.AsyncClient) -> None:
    await create_user(name="Office", username="office", role="ADMIN", password="Temp-1234-start")
    await sign_in(api, "office", "Temp-1234-start", "Office-Strong-77")
    world = await setup_school(api)

    async with make_client() as parent, make_client() as driver, make_client() as outsider:
        await sign_in(parent, "priya", world["parent"]["tempPassword"], "Priya-Strong-22")
        await sign_in(driver, "ravi", world["driver"]["tempPassword"], "Ravi-Strong-33")

        # --- Parent sees the child and marks Riding for this morning.
        home = (await parent.get("/api/parent/home")).json()
        child = home["children"][0]
        assert child["name"] == "Aarav Kumar"
        assert child["bus"]["number"] == "12"
        assert child["stop"]["id"] == world["stop_ids"][1]
        assert len(home["days"]) == 7

        today = today_str()
        r = await parent.put(
            "/api/parent/declarations",
            json={"studentId": child["id"], "date": today, "direction": "AM", "status": "riding"},
        )
        assert r.status_code == 200, r.text

        # --- Driver sees the roster with the riding child at the right stop.
        dhome = (await driver.get("/api/driver/home")).json()
        assert [b["number"] for b in dhome["buses"]] == ["12"]
        roster = (
            await driver.get(f"/api/driver/buses/{world['bus_id']}/roster?direction=AM")
        ).json()
        assert roster["trip"]["status"] == "scheduled"
        assert roster["roster"]["totals"] == {"riding": 1, "absent": 0, "none": 0}
        stop_row = roster["roster"]["stops"][1]
        assert stop_row["students"][0]["status"] == "riding"
        assert [s["kind"] for s in roster["roster"]["stops"]][-1] == "school"

        # --- Start the trip (idempotent for the same driver).
        r = await driver.post(
            "/api/driver/trips/start", json={"busId": world["bus_id"], "direction": "AM"}
        )
        assert r.status_code == 200, r.text
        tid = r.json()["tripId"]
        again = await driver.post(
            "/api/driver/trips/start", json={"busId": world["bus_id"], "direction": "AM"}
        )
        assert again.json()["tripId"] == tid

        # Plans for a running trip are locked.
        r = await parent.put(
            "/api/parent/declarations",
            json={"studentId": child["id"], "date": today, "direction": "AM", "status": "absent"},
        )
        assert r.status_code == 409

        # --- Stream positions: approach stop 1, then drive to stop 2. Fixes must fall
        # between the trip start (minus a minute) and two minutes into the future.
        start = now_ms() - 55_000
        r = await driver.post(
            f"/api/driver/trips/{tid}/locations",
            json={"fixes": fixes_between(13.0800, 13.0851, start, 4)},
        )
        body = r.json()
        assert r.status_code == 200, r.text
        assert body["accepted"] == 4
        assert body["currentStopId"] == world["stop_ids"][0]

        # A wildly inaccurate fix is dropped.
        bad = {"lat": 13.09, "lng": 80.21, "accuracy": 900, "at": start + 70_000}
        r = await driver.post(f"/api/driver/trips/{tid}/locations", json={"fixes": [bad]})
        assert r.json()["rejected"] == {"inaccurate": 1}

        r = await driver.post(
            f"/api/driver/trips/{tid}/locations",
            json={"fixes": fixes_between(13.0851, 13.0930, start + 60_000, 6)},
        )
        assert r.json()["nextStopId"] == world["stop_ids"][1]
        assert r.json()["nextStopEta"] is not None

        # --- Parent follows live. (Trip docs are cached for 2 s per instance; the test
        # runs faster than that, so drop the cached "not started" snapshot.)
        cache.invalidate("trip:")
        live = (await parent.get(f"/api/parent/children/{child['id']}/live")).json()
        trip = live["trip"]
        assert trip["status"] == "in_progress"
        assert trip["position"]["lat"] == pytest.approx(13.0930)
        assert trip["stale"] is False
        assert trip["etaSource"] == "estimate"  # no Maps key in tests
        mine = next(s for s in trip["stops"] if s["id"] == live["myStopId"])
        assert mine["state"] == "pending" and mine["eta"] > live["now"]
        first = trip["stops"][0]
        assert first["state"] == "departed"

        # --- Driver's in-trip view.
        state = (await driver.get(f"/api/driver/trips/{tid}")).json()
        assert state["trip"]["nextStopId"] == world["stop_ids"][1]
        assert state["roster"]["totals"]["riding"] == 1

        # --- Admin sees the bus live and today's counts.
        admin_live = (await api.get("/api/admin/live")).json()
        assert admin_live["buses"][0]["trip"]["status"] == "in_progress"
        counts = (await api.get("/api/admin/today")).json()
        assert counts["totals"]["AM"]["riding"] == 1
        path = (await api.get(f"/api/admin/trips/{tid}/path")).json()
        assert len(path["points"]) == 10

        # --- Access control.
        assert (await parent.get("/api/admin/buses")).status_code == 403
        assert (await driver.get(f"/api/parent/children/{child['id']}/live")).status_code == 403
        assert (await outsider.get("/api/parent/home")).status_code == 401
        r = await parent.post(
            f"/api/driver/trips/{tid}/end", headers={"Origin": "https://evil.example"}
        )
        assert r.status_code == 403 and r.json()["error"]["code"] == "bad_origin"

        # --- End the trip; parents no longer see a live position.
        r = await driver.post(f"/api/driver/trips/{tid}/end")
        assert r.status_code == 200, r.text
        cache.invalidate("trip:")
        live = (await parent.get(f"/api/parent/children/{child['id']}/live?direction=AM")).json()
        assert live["trip"]["status"] == "completed"
        assert live["trip"]["position"] is None
        r = await driver.post(
            "/api/driver/trips/start", json={"busId": world["bus_id"], "direction": "AM"}
        )
        assert r.status_code == 409


async def test_parent_cannot_see_other_children_and_lockout(api: httpx.AsyncClient) -> None:
    await create_user(name="Office", username="office", role="ADMIN", password="Temp-1234-start")
    await sign_in(api, "office", "Temp-1234-start", "Office-Strong-77")
    world = await setup_school(api)
    r = await api.post(
        "/api/admin/users", json={"name": "Other", "username": "other", "role": "PARENT"}
    )
    other = r.json()

    async with make_client() as stranger:
        await sign_in(stranger, "other", other["tempPassword"], "Other-Strong-44")
        r = await stranger.get(f"/api/parent/children/{world['student_id']}/live")
        assert r.status_code == 404
        r = await stranger.put(
            "/api/parent/declarations",
            json={
                "studentId": world["student_id"],
                "date": today_str(),
                "direction": "PM",
                "status": "absent",
            },
        )
        assert r.status_code == 404

    async with make_client() as attacker:
        for _ in range(5):
            r = await attacker.post(
                "/api/auth/login", json={"username": "priya", "password": "nope-nope"}
            )
            assert r.status_code == 401
        r = await attacker.post(
            "/api/auth/login",
            json={"username": "priya", "password": world["parent"]["tempPassword"]},
        )
        assert r.status_code == 429

    # Admin reset clears the lock and forces a new password.
    r = await api.post(f"/api/admin/users/{world['parent']['id']}/reset-password")
    temp = r.json()["tempPassword"]
    async with make_client() as parent:
        await sign_in(parent, "priya", temp, "Priya-Fresh-55")


async def test_traccar_fallback_and_cron(api: httpx.AsyncClient) -> None:
    await create_user(name="Office", username="office", role="ADMIN", password="Temp-1234-start")
    await sign_in(api, "office", "Temp-1234-start", "Office-Strong-77")
    world = await setup_school(api)
    buses = (await api.get("/api/admin/buses")).json()["buses"]
    key = buses[0]["trackerKey"]

    # No trip running yet: acknowledged but ignored.
    r = await api.get(f"/api/ingest/osmand?id={key}&lat=13.08&lon=80.21&accuracy=10")
    assert r.status_code == 200 and r.json()["accepted"] == 0
    r = await api.get("/api/ingest/osmand?id=not-a-key&lat=13.08&lon=80.21")
    assert r.status_code == 401

    async with make_client() as driver:
        await sign_in(driver, "ravi", world["driver"]["tempPassword"], "Ravi-Strong-33")
        r = await driver.post(
            "/api/driver/trips/start", json={"busId": world["bus_id"], "direction": "PM"}
        )
        assert r.status_code == 200, r.text

    r = await api.post(
        f"/api/ingest/osmand?id={key}&lat=13.1140&lon=80.2101&accuracy=10&timestamp={now_ms() // 1000}"
    )
    assert r.status_code == 200 and r.json()["accepted"] == 1

    assert (await api.post("/api/cron/tick")).status_code == 401
    r = await api.post("/api/cron/tick", headers={"X-Cron-Key": "test-cron-secret"})
    assert r.status_code == 200 and r.json()["closedTrips"] == 0


async def test_lockout_holds_under_parallel_attempts(api: httpx.AsyncClient) -> None:
    await create_user(name="Office", username="office", role="ADMIN", password="Temp-1234-start")
    await sign_in(api, "office", "Temp-1234-start", "Office-Strong-77")
    r = await api.post(
        "/api/admin/users", json={"name": "Target", "username": "target", "role": "PARENT"}
    )
    temp = r.json()["tempPassword"]

    async def guess(i: int) -> int:
        async with make_client() as c:
            return (
                await c.post("/api/auth/login", json={"username": "target", "password": f"x{i}"})
            ).status_code

    # A burst of parallel guesses: some are checked (401), the rest refused (429).
    results = await asyncio.gather(*(guess(i) for i in range(12)))
    assert set(results) <= {401, 429}
    checked = results.count(401)

    # Every checked guess was counted, so only the remainder of the five is left.
    more = 0
    while (code := await guess(100 + more)) == 401:
        more += 1
    assert code == 429
    assert checked + more == 5

    # Once locked, even the right password is refused.
    async with make_client() as c:
        r = await c.post("/api/auth/login", json={"username": "target", "password": temp})
        assert r.status_code == 429


async def test_odd_usernames_fail_cleanly(api: httpx.AsyncClient) -> None:
    for name in (".", "..", "__x__", "a/b", "ÅÄÖ"):
        r = await api.post("/api/auth/login", json={"username": name, "password": "whatever1"})
        assert r.status_code == 401, (name, r.text)


async def test_bus_deletion_unassigns_drivers_and_disable_kills_sessions(
    api: httpx.AsyncClient,
) -> None:
    await create_user(name="Office", username="office", role="ADMIN", password="Temp-1234-start")
    await sign_in(api, "office", "Temp-1234-start", "Office-Strong-77")
    world = await setup_school(api)
    driver_id = world["driver"]["id"]

    async with make_client() as driver:
        await sign_in(driver, "ravi", world["driver"]["tempPassword"], "Ravi-Strong-33")
        assert (await driver.get("/api/driver/home")).json()["buses"]

        # Deleting the bus removes it from the driver, and the driver stays editable.
        assert (await api.delete(f"/api/admin/buses/{world['bus_id']}")).status_code == 200
        users = (await api.get("/api/admin/users")).json()["users"]
        assert next(u for u in users if u["id"] == driver_id)["busIds"] == []
        r = await api.put(
            f"/api/admin/users/{driver_id}",
            json={"name": "Ravi", "mobile": "", "active": True, "busIds": ["gone-bus"]},
        )
        assert r.status_code == 200, r.text

        # Turning the account off and on again does not revive the old session.
        body = {"name": "Ravi", "mobile": "", "active": False, "busIds": []}
        assert (await api.put(f"/api/admin/users/{driver_id}", json=body)).status_code == 200
        assert (await driver.get("/api/driver/home")).status_code == 401
        body["active"] = True
        assert (await api.put(f"/api/admin/users/{driver_id}", json=body)).status_code == 200
        assert (await driver.get("/api/driver/home")).status_code == 401


async def test_one_running_trip_per_driver_even_when_racing(api: httpx.AsyncClient) -> None:
    await create_user(name="Office", username="office", role="ADMIN", password="Temp-1234-start")
    await sign_in(api, "office", "Temp-1234-start", "Office-Strong-77")
    world = await setup_school(api)
    route_b = (
        await api.post(
            "/api/admin/routes",
            json={"name": "Route 2", "stops": [{"name": "Stop X", "lat": 13.2, "lng": 80.3}]},
        )
    ).json()["id"]
    bus_b = (await api.post("/api/admin/buses", json={"number": "14", "routeId": route_b})).json()[
        "id"
    ]
    # Let the driver run any bus.
    await api.put(
        f"/api/admin/users/{world['driver']['id']}",
        json={"name": "Ravi", "mobile": "", "active": True, "busIds": []},
    )

    async with make_client() as driver:
        await sign_in(driver, "ravi", world["driver"]["tempPassword"], "Ravi-Strong-33")
        results = await asyncio.gather(
            driver.post(
                "/api/driver/trips/start", json={"busId": world["bus_id"], "direction": "AM"}
            ),
            driver.post("/api/driver/trips/start", json={"busId": bus_b, "direction": "AM"}),
        )
        codes = sorted(r.status_code for r in results)
        assert codes == [200, 409], [r.text for r in results]

        # Ending the trip frees the driver to start the other bus.
        started = next(r for r in results if r.status_code == 200).json()["tripId"]
        assert (await driver.post(f"/api/driver/trips/{started}/end")).status_code == 200
        other = bus_b if world["bus_id"] in started else world["bus_id"]
        r = await driver.post("/api/driver/trips/start", json={"busId": other, "direction": "AM"})
        assert r.status_code == 200, r.text


async def test_two_campuses_day_log_and_summary(
    api: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app import ai
    from app.timeutil import add_days

    await create_user(name="Office", username="office", role="ADMIN", password="Temp-1234-start")
    await sign_in(api, "office", "Temp-1234-start", "Office-Strong-77")

    # --- Two campuses; the morning bus drops at the junior campus, then the main one.
    settings = {
        "name": "Einstein Test School",
        "address": "",
        "campuses": [
            {
                "name": "Main Campus",
                "address": "Main Rd",
                "location": {"lat": 13.0950, "lng": 80.2101},
            },
            {
                "name": "Junior Campus",
                "address": "Park Rd",
                "location": {"lat": 13.0900, "lng": 80.2101},
            },
        ],
        "amCutoff": "23:58",
        "pmCutoff": "23:59",
        "approachMinutes": 10,
        "arrivalRadiusM": 120,
        "serviceDays": [1, 2, 3, 4, 5, 6, 7],
        "holidays": [],
    }
    r = await api.put("/api/admin/settings", json=settings)
    assert r.status_code == 200, r.text
    campuses = r.json()["settings"]["campuses"]
    main, junior = campuses[0]["id"], campuses[1]["id"]
    assert [c["name"] for c in campuses] == ["Main Campus", "Junior Campus"]

    pickup = [{"name": "Shenoy Nagar", "lat": 13.0850, "lng": 80.2101}]
    r = await api.post(
        "/api/admin/routes", json={"name": "Route C", "stops": pickup, "campusIds": ["nope"]}
    )
    assert r.status_code == 400
    r = await api.post(
        "/api/admin/routes",
        json={"name": "Route C", "stops": pickup, "campusIds": [junior, main]},
    )
    assert r.status_code == 200, r.text
    route_id = r.json()["id"]
    r = await api.post(
        "/api/admin/routes", json={"name": "Route D", "stops": pickup, "campusIds": [main]}
    )
    main_only = r.json()["id"]
    routes = {x["id"]: x for x in (await api.get("/api/admin/routes")).json()["routes"]}
    assert routes[route_id]["campusIds"] == [junior, main]
    stop_id = routes[route_id]["stops"][0]["id"]

    bus_id = (
        await api.post("/api/admin/buses", json={"number": "21", "routeId": route_id})
    ).json()["id"]
    parent = (
        await api.post(
            "/api/admin/users", json={"name": "Lakshmi", "username": "lakshmi", "role": "PARENT"}
        )
    ).json()
    driver = (
        await api.post(
            "/api/admin/users",
            json={"name": "Murugan", "username": "murugan", "role": "DRIVER", "busIds": [bus_id]},
        )
    ).json()

    async def add_student(name: str, route: str, campus: str) -> httpx.Response:
        return await api.post(
            "/api/admin/students",
            json={
                "name": name,
                "grade": "3A",
                "routeId": route,
                "stopId": routes[route]["stops"][0]["id"],
                "campusId": campus,
                "parentIds": [parent["id"]],
            },
        )

    assert (await add_student("Kavya Mani", route_id, main)).status_code == 200
    assert (await add_student("Arjun Mani", route_id, junior)).status_code == 200
    # Route D's bus never goes to the junior campus.
    assert (await add_student("Nobody", main_only, junior)).status_code == 400

    students = {s["name"]: s for s in (await api.get("/api/admin/students")).json()["students"]}
    assert students["Kavya Mani"]["campusName"] == "Main Campus"
    assert students["Arjun Mani"]["campusName"] == "Junior Campus"

    # A campus that routes and students still use can't be removed.
    in_use = {**settings, "campuses": [{**campuses[0]}]}
    r = await api.put("/api/admin/settings", json=in_use)
    assert r.status_code == 409, r.text

    async with make_client() as parent_app, make_client() as driver_app:
        await sign_in(parent_app, "lakshmi", parent["tempPassword"], "Lakshmi-Strong-1")
        await sign_in(driver_app, "murugan", driver["tempPassword"], "Murugan-Strong-2")

        home = (await parent_app.get("/api/parent/home")).json()
        kids = {c["name"]: c for c in home["children"]}
        assert kids["Kavya Mani"]["campus"]["name"] == "Main Campus"
        assert [c["name"] for c in home["school"]["campuses"]] == ["Main Campus", "Junior Campus"]
        for kid in kids.values():
            r = await parent_app.put(
                "/api/parent/declarations",
                json={
                    "studentId": kid["id"],
                    "date": today_str(),
                    "direction": "AM",
                    "status": "riding",
                },
            )
            assert r.status_code == 200, r.text

        # Each campus row counts the students who go to that campus.
        roster = (await driver_app.get(f"/api/driver/buses/{bus_id}/roster?direction=AM")).json()
        rows = roster["roster"]["stops"]
        assert [r["id"] for r in rows] == [stop_id, f"school-{junior}", f"school-{main}"]
        assert [r["counts"]["riding"] for r in rows] == [2, 1, 1]

        r = await driver_app.post(
            "/api/driver/trips/start", json={"busId": bus_id, "direction": "AM"}
        )
        assert r.status_code == 200, r.text
        tid = r.json()["tripId"]

        # Drive north past the pickup, the junior campus and then the main campus.
        start = now_ms() - 55_000
        fixes = [
            {"lat": 13.0800 + i * 0.0005, "lng": 80.2101, "accuracy": 8, "at": start + i * 3_000}
            for i in range(32)
        ]
        for i in range(0, len(fixes), 8):
            r = await driver_app.post(
                f"/api/driver/trips/{tid}/locations", json={"fixes": fixes[i : i + 8]}
            )
            assert r.status_code == 200, r.text
            assert r.json()["accepted"] == len(fixes[i : i + 8])

        cache.invalidate("trip:")
        live = (
            await parent_app.get(f"/api/parent/children/{kids['Kavya Mani']['id']}/live")
        ).json()
        assert live["myCampusStopId"] == f"school-{main}"
        states = {s["id"]: s["state"] for s in live["trip"]["stops"]}
        assert states[f"school-{junior}"] in ("arrived", "departed")
        assert states[f"school-{main}"] in ("arrived", "departed")
        assert live["trip"]["schoolReachedAt"] is not None
        junior_live = (
            await parent_app.get(f"/api/parent/children/{kids['Arjun Mani']['id']}/live")
        ).json()
        assert junior_live["myCampusStopId"] == f"school-{junior}"

        assert (await driver_app.post(f"/api/driver/trips/{tid}/end")).status_code == 200

    # --- The activity log is read one day at a time.
    today = today_str()
    log = (await api.get(f"/api/admin/audit?date={today}")).json()
    actions = [e["action"] for e in log["entries"]]
    assert {"settings.updated", "route.created", "student.created"} <= set(actions)
    ats = [e["at"] for e in log["entries"]]
    assert ats == sorted(ats, reverse=True)
    assert (await api.get(f"/api/admin/audit?date={add_days(today, -1)}")).json()["entries"] == []
    assert (await api.get("/api/admin/audit?date=2026-13-40")).status_code == 400

    # --- Daily summary: off until a model is configured.
    r = await api.get(f"/api/admin/summaries/{today}")
    assert r.json() == {"summary": None, "enabled": False}
    r = await api.post(f"/api/admin/summaries/{today}")
    assert r.status_code == 503

    seen: list[dict[str, Any]] = []

    async def fake_summary(facts: dict[str, Any]) -> ai.DaySummary:
        seen.append(facts)
        return ai.DaySummary(
            headline="Bus 21 ran its morning trip.",
            highlights=["Reached Junior Campus, then Main Campus."],
            attention=[],
        )

    monkeypatch.setattr(ai, "ai_enabled", lambda: True)
    monkeypatch.setattr(ai, "write_day_summary", fake_summary)

    r = await api.post(f"/api/admin/summaries/{today}")
    assert r.status_code == 200, r.text
    summary = r.json()["summary"]
    assert summary["headline"] == "Bus 21 ran its morning trip."
    assert summary["partial"] is True

    facts = seen[0]
    assert facts["campuses"] == ["Main Campus", "Junior Campus"]
    assert facts["plans"]["morning"]["riding"] == 2
    trip = facts["trips"][0]
    assert trip["bus"] == "21" and trip["status"] == "completed" and trip["ended_by"] == "driver"
    assert [c["campus"] for c in trip["campus_arrivals"]] == ["Junior Campus", "Main Campus"]
    text = repr(facts)
    for name in ("Kavya", "Arjun", "Lakshmi", "lakshmi"):
        assert name not in text  # students and parents never reach the model

    # Asking again within a minute reuses the stored summary.
    again = (await api.post(f"/api/admin/summaries/{today}")).json()["summary"]
    assert again["generatedAt"] == summary["generatedAt"] and len(seen) == 1
    stored = (await api.get(f"/api/admin/summaries/{today}")).json()
    assert stored["summary"]["headline"] == summary["headline"] and stored["enabled"] is True
    assert (await api.post(f"/api/admin/summaries/{add_days(today, 1)}")).status_code == 400


async def test_evening_summary_is_written_once_on_bus_days(
    api: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app import ai
    from app.services import cron
    from app.services.daily import get_summary
    from app.services.school import save_school
    from app.timeutil import local_now

    calls: list[dict[str, Any]] = []

    async def fake_summary(facts: dict[str, Any]) -> ai.DaySummary:
        calls.append(facts)
        return ai.DaySummary(headline="A calm day.", highlights=[], attention=[])

    monkeypatch.setattr(ai, "ai_enabled", lambda: True)
    monkeypatch.setattr(ai, "write_day_summary", fake_summary)
    monkeypatch.setattr(cron, "local_now", lambda ms=None: local_now(ms).replace(hour=20))
    today = today_str()

    # A holiday with no buses: nothing to summarize.
    await save_school({"holidays": [today]})
    assert await cron.write_evening_summary() is False

    # A bus day: the final summary is written once, then left alone.
    await save_school({"holidays": [], "serviceDays": [1, 2, 3, 4, 5, 6, 7]})
    assert await cron.write_evening_summary() is True
    assert await cron.write_evening_summary() is False
    summary = await get_summary(today)
    assert summary is not None and summary["partial"] is False
    assert len(calls) == 1
