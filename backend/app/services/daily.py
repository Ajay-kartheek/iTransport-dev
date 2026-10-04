"""The day's facts for the AI summary, and storing the summaries."""

from __future__ import annotations

import logging
from collections import Counter
from datetime import date as date_type
from typing import Any

from google.cloud import firestore
from google.cloud.firestore import FieldFilter

from .. import ai
from ..config import get_settings
from ..db import AUDIT, BUSES, DECLARATIONS, POINTS, STUDENTS, TRIPS, get_db
from ..timeutil import DIRECTIONS, add_days, local_ms, local_now, now_ms, today_str
from .school import campuses_of, get_school, is_service_day
from .trips import list_docs, trips_on

log = logging.getLogger("itransport.daily")

SUMMARIES = "daySummaries"
REFRESH_AFTER_MS = 60_000  # don't regenerate the same day more than once a minute
GAP_WORTH_MENTIONING_MIN = 3

_OFFICE_ACTIONS = {
    "route": "routes",
    "bus": "buses",
    "student": "students",
    "user": "logins",
    "settings": "settings",
}


def _clock(ms: int | None) -> str | None:
    return local_now(ms).strftime("%-I:%M %p") if ms else None


async def entries_on(day: str, limit: int = 1000) -> list[dict[str, Any]]:
    """Audit entries for one school-local day, newest first."""
    start, end = local_ms(day, "00:00"), local_ms(add_days(day, 1), "00:00")
    query = (
        get_db()
        .collection(AUDIT)
        .where(filter=FieldFilter("at", ">=", start))
        .where(filter=FieldFilter("at", "<", end))
        .order_by("at", direction=firestore.Query.DESCENDING)
        .limit(limit)
    )
    entries = []
    async for snap in query.stream():
        data = snap.to_dict() or {}
        data.pop("expireAt", None)
        entries.append({"id": snap.id, **data})
    return entries


async def _longest_gap_minutes(trip_id: str) -> int:
    query = get_db().collection(TRIPS).document(trip_id).collection(POINTS).order_by("at")
    previous, longest = None, 0
    async for snap in query.stream():
        at = int((snap.to_dict() or {}).get("at") or 0)
        if previous is not None:
            longest = max(longest, at - previous)
        previous = at
    return round(longest / 60_000)


def _ended_by(trip: dict[str, Any]) -> str | None:
    if trip.get("status") != "completed":
        return None
    who = trip.get("endedBy")
    if who == "Auto-closed":
        return "auto-closed"
    return "driver" if who == trip.get("driverName") else "office"


async def day_facts(day: str) -> dict[str, Any]:
    """Everything the summary may mention, computed from records (no student names)."""
    school = await get_school()
    now = now_ms()
    today = today_str(now)
    trips = sorted(await trips_on(day), key=lambda t: t.get("startedAt") or 0)
    buses = [b for b in await list_docs(BUSES) if b.get("active", True) and b.get("routeId")]
    served_routes = {b["routeId"] for b in buses}
    riders = [
        s
        for s in await list_docs(STUDENTS)
        if s.get("active", True) and s.get("routeId") in served_routes
    ]

    marks: dict[tuple[str, str], str] = {}
    query = get_db().collection(DECLARATIONS).where(filter=FieldFilter("date", "==", day))
    async for snap in query.stream():
        d = snap.to_dict() or {}
        marks[(d.get("studentId"), d.get("direction"))] = d.get("status")
    plans = {}
    for direction in DIRECTIONS:
        statuses = [marks.get((s["id"], direction), "none") for s in riders]
        plans["morning" if direction == "AM" else "afternoon"] = {
            "riding": statuses.count("riding"),
            "absent": statuses.count("absent"),
            "no_reply": statuses.count("none"),
        }

    trip_facts = []
    for t in trips:
        stops = t.get("stops") or []
        progress = t.get("progress") or {}
        pickups = [s for s in stops if s.get("kind") == "stop"]
        reached = [s for s in pickups if (progress.get(s["id"]) or {}).get("arrivedAt")]
        passed = [s["name"] for s in pickups if (progress.get(s["id"]) or {}).get("skipped")]
        campus_times = [
            {"campus": s["name"], "time": _clock((progress.get(s["id"]) or {}).get("arrivedAt"))}
            for s in stops
            if s.get("kind") == "school" and (progress.get(s["id"]) or {}).get("arrivedAt")
        ]
        if t.get("direction") == "PM" and campus_times:
            campus_times = campus_times[1:]  # the first campus is where the trip started
        gap = await _longest_gap_minutes(t["id"]) if t.get("pointCount") else 0
        started, ended = t.get("startedAt"), t.get("endedAt")
        trip_facts.append(
            {
                "bus": t.get("busNumber"),
                "trip": "morning" if t.get("direction") == "AM" else "afternoon",
                "route": t.get("routeName"),
                "driver": t.get("driverName"),
                "status": "running" if t.get("status") == "in_progress" else "completed",
                "started": _clock(started),
                "ended": _clock(ended),
                "duration_minutes": round((ended - started) / 60_000)
                if started and ended
                else None,
                "stops_reached": len(reached),
                "stops_total": len(pickups),
                "stops_passed_without_stopping": passed,
                "campus_arrivals": campus_times,
                "ended_by": _ended_by(t),
                "location_updates": int(t.get("pointCount") or 0),
                "longest_location_gap_minutes": gap if gap >= GAP_WORTH_MENTIONING_MIN else None,
                "bus_close_alerts_sent": sum(
                    1 for k in t.get("alerts") or {} if k.startswith("approach_")
                ),
            }
        )

    entries = await entries_on(day)
    office = Counter(
        _OFFICE_ACTIONS[e["targetType"]]
        for e in entries
        if e.get("actorRole") == "ADMIN" and e.get("targetType") in _OFFICE_ACTIONS
    )
    password_resets = sum(1 for e in entries if e.get("action") == "user.password_reset")
    plan_changes = sum(1 for e in entries if e.get("action") == "declaration.set")

    school_day = is_service_day(school, day)
    hour = local_now(now).hour
    not_run: dict[str, list[str]] = {}
    for direction, label, after_hour in (("AM", "morning", 11), ("PM", "afternoon", 17)):
        if school_day and (day < today or (day == today and hour >= after_hour)):
            ran = {t.get("busId") for t in trips if t.get("direction") == direction}
            missing = [b.get("number") for b in buses if b["id"] not in ran]
            if missing:
                not_run[label] = missing

    return {
        "school": school.get("name"),
        "date": date_type.fromisoformat(day).strftime("%A, %-d %B %Y"),
        "is_today": day == today,
        "as_of": _clock(now) if day == today else None,
        "school_day": school_day,
        "holiday": day in (school.get("holidays") or []),
        "campuses": [c.get("name") for c in campuses_of(school)],
        "students_on_bus_routes": len(riders),
        "plans": plans,
        "riding_absent_changes_made_by_parents": plan_changes,
        "trips": trip_facts,
        "buses_that_did_not_run": not_run,
        "office_changes": dict(office),
        "password_resets": password_resets,
    }


async def get_summary(day: str) -> dict[str, Any] | None:
    snap = await get_db().collection(SUMMARIES).document(day).get()
    return snap.to_dict() if snap.exists else None


async def generate_summary(day: str, *, final: bool = False) -> dict[str, Any]:
    """Write (or rewrite) the day's summary. Reuses one made in the last minute."""
    existing = await get_summary(day)
    now = now_ms()
    if existing and now - int(existing.get("generatedAt") or 0) < REFRESH_AFTER_MS and not final:
        return existing
    facts = await day_facts(day)
    summary = await ai.write_day_summary(facts)
    doc = {
        "date": day,
        "headline": summary.headline.strip(),
        "highlights": [h.strip() for h in summary.highlights if h.strip()][:6],
        "attention": [a.strip() for a in summary.attention if a.strip()][:6],
        "generatedAt": now,
        "partial": bool(facts["is_today"]) and not final,
        "model": get_settings().ai_model,
    }
    await get_db().collection(SUMMARIES).document(day).set(doc)
    return doc
