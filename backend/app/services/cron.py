"""Scheduled work, triggered every ~15 minutes by Cloud Scheduler."""

from __future__ import annotations

import logging
from typing import Any

from google.api_core.exceptions import Conflict

from .. import ai, push
from ..db import REMINDERS, STUDENTS, get_db
from ..timeutil import add_days, local_now, now_ms, today_str
from .daily import generate_summary, get_summary
from .school import get_school, is_service_day, reminder_at_ms, trip_cutoff_ms
from .trips import complete_trip, declarations_for, list_docs, trips_on

log = logging.getLogger("itransport.cron")

ABANDONED_AFTER_MS = 6 * 60 * 60_000
EVENING_SUMMARY_HOUR = 20


def _when(date: str, direction: str, today: str) -> str:
    if direction == "PM":
        return "this afternoon" if date == today else "in the afternoon"
    return "this morning" if date == today else "tomorrow morning"


def _names(names: list[str]) -> str:
    firsts = [n.split()[0] if n else "your child" for n in names]
    return firsts[0] if len(firsts) == 1 else ", ".join(firsts[:-1]) + " and " + firsts[-1]


async def send_due_reminders() -> dict[str, int]:
    """Remind parents who haven't marked Riding/Absent before a trip's cutoff."""
    school = await get_school()
    now = now_ms()
    today = today_str(now)
    sent: dict[str, int] = {}
    slots = [(today, "AM"), (today, "PM"), (add_days(today, 1), "AM")]
    for date, direction in slots:
        if not is_service_day(school, date):
            continue
        cutoff = trip_cutoff_ms(school, date, direction)
        if not (reminder_at_ms(school, date, direction) <= now < cutoff):
            continue
        slot_ref = get_db().collection(REMINDERS).document(f"{date}_{direction}")
        try:
            await slot_ref.create({"at": now, "count": 0})  # each slot is reminded once
        except Conflict:
            continue

        students = [
            s for s in await list_docs(STUDENTS) if s.get("active", True) and s.get("routeId")
        ]
        decl = await declarations_for(date, direction, [s["id"] for s in students])
        waiting: dict[str, list[str]] = {}
        for student in students:
            if student["id"] in decl:
                continue
            for pid in student.get("parentIds") or []:
                waiting.setdefault(pid, []).append(student.get("name", ""))

        cutoff_label = local_now(cutoff).strftime("%-I:%M %p")
        messages: dict[str, dict[str, Any]] = {
            pid: {
                "title": f"Will {_names(names)} take the bus {_when(date, direction, today)}?",
                "body": f"Tap to mark Riding or Absent before {cutoff_label}.",
                "tag": f"remind-{date}-{direction}",
                "url": "/",
            }
            for pid, names in waiting.items()
        }
        delivered = await push.send_each(messages, ttl=3600)
        await slot_ref.update({"count": delivered, "parents": len(messages)})
        sent[f"{date}_{direction}"] = delivered
    return sent


async def close_abandoned_trips() -> int:
    """Complete trips a driver forgot to end, so parents stop seeing them as live."""
    now = now_ms()
    today = today_str(now)
    closed = 0
    for date in (add_days(today, -1), today):
        for trip in await trips_on(date):
            if trip.get("status") != "in_progress":
                continue
            if now - int(trip.get("startedAt") or now) < ABANDONED_AFTER_MS:
                continue
            await complete_trip(trip["id"], ended_by="Auto-closed")
            closed += 1
    return closed


async def write_evening_summary() -> bool:
    """After 8 PM, write the day's final AI summary once (if AI summaries are on)."""
    now = now_ms()
    if not ai.ai_enabled() or local_now(now).hour < EVENING_SUMMARY_HOUR:
        return False
    today = today_str(now)
    existing = await get_summary(today)
    if existing and not existing.get("partial"):
        return False
    if not is_service_day(await get_school(), today) and not await trips_on(today):
        return False  # no buses ran: nothing worth summarizing
    try:
        await generate_summary(today, final=True)
    except Exception:
        log.exception("Evening summary failed")
        return False
    return True


async def run_tick() -> dict[str, Any]:
    reminders = await send_due_reminders()
    closed = await close_abandoned_trips()
    summarized = await write_evening_summary()
    log.info("cron tick: reminders=%s closed=%s summary=%s", reminders, closed, summarized)
    return {"reminders": reminders, "closedTrips": closed, "summaryWritten": summarized}
