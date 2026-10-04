"""Seed a demo school: two Chennai routes, buses, drivers, parents and students.

Meant for local development and demos — every demo account gets the same
password, so don't run this against a database real families use.

    FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 uv run python -m scripts.seed_demo --password demo-pass-2026
"""

from __future__ import annotations

import argparse
import asyncio
import secrets

from google.cloud.firestore import FieldFilter

from app.db import BUSES, ROUTES, SCHOOL_SETTINGS_DOC, SETTINGS, STUDENTS, USERNAMES, USERS, get_db
from app.security import generate_tracker_key, hash_password
from app.services.users import create_user
from app.timeutil import now_ms

CAMPUSES = [
    {
        "id": "main",
        "name": "Main Campus",
        "address": "Kilpauk, Chennai",
        "location": {"lat": 13.0815, "lng": 80.2420},
    },
    {
        "id": "junior",
        "name": "Junior Campus",
        "address": "Anna Nagar East, Chennai",
        "location": {"lat": 13.0905, "lng": 80.2290},
    },
]

SCHOOL = {
    "name": "Einstein Public School",
    "address": "Chennai",
    "campuses": CAMPUSES,
    "location": None,
    "amCutoff": "06:30",
    "pmCutoff": "12:30",
    "approachMinutes": 10,
    "arrivalRadiusM": 120,
    "serviceDays": [1, 2, 3, 4, 5, 6],
    "holidays": [],
}

# (route name, campuses in morning order, stops)
ROUTE_DATA = [
    (
        "Route A — Anna Nagar",
        ["junior", "main"],
        [
            ("Thirumangalam Junction", "100 Feet Road", 13.0857, 80.2018),
            ("Anna Nagar Tower Park", "2nd Avenue", 13.0870, 80.2098),
            ("Shanthi Colony", "4th Avenue", 13.0829, 80.2162),
            ("Anna Nagar East", "3rd Main Road", 13.0847, 80.2248),
            ("Shenoy Nagar", "Pulla Avenue", 13.0790, 80.2304),
        ],
    ),
    (
        "Route B — Kolathur",
        ["main"],
        [
            ("Kolathur", "Red Hills Road", 13.1240, 80.2120),
            ("Villivakkam", "MTH Road", 13.1084, 80.2066),
            ("Ayanavaram", "Konnur High Road", 13.0985, 80.2337),
            ("Purasaiwakkam", "Purasaiwakkam High Road", 13.0880, 80.2550),
            ("Kellys", "Kellys Road", 13.0868, 80.2435),
        ],
    ),
]

BUS_DATA = [("7", "TN 01 AB 2207", 40), ("12", "TN 09 BC 4512", 40)]
DRIVERS = [("ravi", "Ravi Kumar", "98400 11111"), ("suresh", "Suresh Murugan", "98400 22222")]
PARENTS = [
    ("priya", "Priya Raman", "98410 10001"),
    ("arun", "Arun Prakash", "98410 10002"),
    ("meena", "Meena Sundar", "98410 10003"),
    ("karthik", "Karthik Rajan", "98410 10004"),
    ("divya", "Divya Krishnan", "98410 10005"),
]
# (student name, grade, route index, stop index, campus, parent usernames)
STUDENT_DATA = [
    ("Aarav Raman", "4B", 0, 1, "main", ["priya"]),
    ("Diya Raman", "1A", 1, 2, "main", ["priya"]),
    ("Kavin Prakash", "6C", 0, 0, "main", ["arun"]),
    ("Ishaan Sundar", "3A", 0, 2, "junior", ["meena"]),
    ("Nila Sundar", "5B", 0, 2, "main", ["meena"]),
    ("Vikram Rajan", "8A", 0, 3, "main", ["karthik"]),
    ("Anika Krishnan", "2C", 0, 4, "junior", ["divya"]),
    ("Rohan Prakash", "7B", 1, 0, "main", ["arun"]),
    ("Meera Rajan", "4A", 1, 1, "main", ["karthik"]),
    ("Sai Krishnan", "9C", 1, 3, "main", ["divya"]),
    ("Tara Sundar", "1B", 1, 4, "main", ["meena"]),
]


async def _user_id(username: str) -> str | None:
    snap = await get_db().collection(USERNAMES).document(username).get()
    return (snap.to_dict() or {}).get("userId") if snap.exists else None


async def _ensure_user(username: str, name: str, role: str, mobile: str, password: str) -> str:
    uid = await _user_id(username)
    if uid is None:
        uid, _ = await create_user(
            name=name, username=username, role=role, mobile=mobile, password=password
        )
    await (
        get_db()
        .collection(USERS)
        .document(uid)
        .update(
            {"passwordHash": hash_password(password), "mustChangePassword": False, "active": True}
        )
    )
    return uid


async def seed(password: str, every_day: bool) -> None:
    db = get_db()
    existing = [
        s
        async for s in db.collection(ROUTES).where(filter=FieldFilter("demo", "==", True)).stream()
    ]
    if existing:
        print("Demo data already exists — refreshing passwords only.")

    school = {
        **SCHOOL,
        "serviceDays": [1, 2, 3, 4, 5, 6, 7] if every_day else SCHOOL["serviceDays"],
    }
    await db.collection(SETTINGS).document(SCHOOL_SETTINGS_DOC).set(school, merge=True)

    admin_id = await _ensure_user("admin", "Transport Office", "ADMIN", "", password)
    driver_ids = [await _ensure_user(u, n, "DRIVER", m, password) for u, n, m in DRIVERS]
    parent_ids = {u: await _ensure_user(u, n, "PARENT", m, password) for u, n, m in PARENTS}

    if not existing:
        now = now_ms()
        route_ids: list[tuple[str, list[str]]] = []
        for name, campus_ids, stops in ROUTE_DATA:
            stop_docs = [
                {"id": "s" + secrets.token_hex(4), "name": n, "address": a, "lat": lat, "lng": lng}
                for n, a, lat, lng in stops
            ]
            ref = db.collection(ROUTES).document()
            await ref.set(
                {
                    "name": name,
                    "stops": stop_docs,
                    "campusIds": campus_ids,
                    "demo": True,
                    "createdAt": now,
                    "updatedAt": now,
                }
            )
            route_ids.append((ref.id, [s["id"] for s in stop_docs]))

        bus_ids = []
        for (number, plate, capacity), (route_id, _) in zip(BUS_DATA, route_ids, strict=True):
            ref = db.collection(BUSES).document()
            await ref.set(
                {
                    "number": number,
                    "plate": plate,
                    "capacity": capacity,
                    "routeId": route_id,
                    "active": True,
                    "trackerKey": generate_tracker_key(),
                    "demo": True,
                    "createdAt": now,
                    "updatedAt": now,
                }
            )
            bus_ids.append(ref.id)

        for driver_id, bus_id in zip(driver_ids, bus_ids, strict=True):
            await db.collection(USERS).document(driver_id).update({"busIds": [bus_id]})

        for name, grade, route_index, stop_index, campus_id, parents in STUDENT_DATA:
            route_id, stop_ids = route_ids[route_index]
            await db.collection(STUDENTS).add(
                {
                    "name": name,
                    "grade": grade,
                    "routeId": route_id,
                    "stopId": stop_ids[stop_index],
                    "campusId": campus_id,
                    "parentIds": [parent_ids[p] for p in parents],
                    "active": True,
                    "demo": True,
                    "createdAt": now,
                    "updatedAt": now,
                }
            )

    print(
        f"\nDemo school ready (admin id {admin_id}). Everyone signs in with password: {password}\n"
    )
    print("  admin                      transport office")
    for u, n, _ in DRIVERS:
        print(f"  {u:<26} driver · {n}")
    for u, n, _ in PARENTS:
        print(f"  {u:<26} parent · {n}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--password", required=True, help="password for every demo account (min 8 chars)"
    )
    parser.add_argument(
        "--every-day", action="store_true", help="run buses 7 days a week (handy for testing)"
    )
    args = parser.parse_args()
    if len(args.password) < 8:
        parser.error("use at least 8 characters")
    asyncio.run(seed(args.password, args.every_day))


if __name__ == "__main__":
    main()
