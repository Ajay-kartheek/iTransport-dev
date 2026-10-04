"""School-wide settings (one document) with sensible pilot defaults.

A school has one or more campuses. Each route lists the campuses its bus
visits, in morning order; afternoon trips visit them in reverse.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from .. import cache
from ..db import SCHOOL_SETTINGS_DOC, SETTINGS, get_db
from ..timeutil import add_days, cutoff_ms, local_ms

MAX_CAMPUSES = 4
LEGACY_CAMPUS_ID = "main"

DEFAULTS: dict[str, Any] = {
    "name": "Einstein Public School",
    "address": "",
    "campuses": [],
    "location": None,  # legacy single location, read as one campus
    "amCutoff": "06:30",
    "pmCutoff": "12:30",
    "approachMinutes": 10,
    "arrivalRadiusM": 120,
    "serviceDays": [1, 2, 3, 4, 5],
    "holidays": [],
}

_CACHE_KEY = "school-settings"


async def get_school() -> dict[str, Any]:
    async def load() -> dict[str, Any]:
        snap = await get_db().collection(SETTINGS).document(SCHOOL_SETTINGS_DOC).get()
        return {**DEFAULTS, **(snap.to_dict() or {})} if snap.exists else dict(DEFAULTS)

    return dict(await cache.cached(_CACHE_KEY, 10, load))


async def save_school(values: dict[str, Any]) -> dict[str, Any]:
    await get_db().collection(SETTINGS).document(SCHOOL_SETTINGS_DOC).set(values, merge=True)
    cache.invalidate(_CACHE_KEY)
    return await get_school()


def campuses_of(school: dict[str, Any]) -> list[dict[str, Any]]:
    """Campuses with a location, in the order the office listed them."""
    campuses = [c for c in school.get("campuses") or [] if c.get("location")]
    if campuses:
        return campuses
    if school.get("location"):  # settings saved before campuses existed
        return [
            {
                "id": LEGACY_CAMPUS_ID,
                "name": school.get("name") or "School",
                "address": school.get("address", ""),
                "location": school["location"],
            }
        ]
    return []


def route_campus_ids(route: dict[str, Any] | None, school: dict[str, Any]) -> list[str]:
    """The campuses a route's bus visits, in morning order (defaults to the first campus)."""
    known = [c["id"] for c in campuses_of(school)]
    chosen = [cid for cid in (route or {}).get("campusIds") or [] if cid in known]
    return list(dict.fromkeys(chosen)) or known[:1]


def student_campus_id(student: dict[str, Any], campus_ids: list[str]) -> str | None:
    """The campus a student attends among the ones their bus visits."""
    chosen = student.get("campusId")
    if chosen in campus_ids:
        return chosen
    return campus_ids[0] if campus_ids else None


def is_service_day(school: dict[str, Any], date_str: str) -> bool:
    if date_str in (school.get("holidays") or []):
        return False
    return date.fromisoformat(date_str).isoweekday() in (school.get("serviceDays") or [])


def upcoming_service_days(school: dict[str, Any], today: str, count: int = 7) -> list[str]:
    days: list[str] = []
    d = today
    for _ in range(31):
        if is_service_day(school, d):
            days.append(d)
            if len(days) >= count:
                break
        d = add_days(d, 1)
    return days


def trip_cutoff_ms(school: dict[str, Any], date_str: str, direction: str) -> int:
    return cutoff_ms(date_str, direction, school["amCutoff"], school["pmCutoff"])  # type: ignore[arg-type]


def reminder_at_ms(school: dict[str, Any], date_str: str, direction: str) -> int:
    """Morning trips are reminded the evening before; afternoon trips an hour before cutoff."""
    if direction == "AM":
        return local_ms(add_days(date_str, -1), "19:00")
    return trip_cutoff_ms(school, date_str, direction) - 60 * 60_000


def public_campus(campus: dict[str, Any]) -> dict[str, Any]:
    location = campus.get("location") or {}
    return {
        "id": campus["id"],
        "name": campus.get("name", ""),
        "address": campus.get("address", ""),
        "location": {"lat": location.get("lat"), "lng": location.get("lng")},
    }


def public_school(school: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": school["name"],
        "campuses": [public_campus(c) for c in campuses_of(school)],
        "amCutoff": school["amCutoff"],
        "pmCutoff": school["pmCutoff"],
        "approachMinutes": school["approachMinutes"],
    }
