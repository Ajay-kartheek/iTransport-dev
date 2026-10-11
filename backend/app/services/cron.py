"""Scheduled work, triggered every ~15 minutes by Cloud Scheduler."""

from __future__ import annotations

import logging
from typing import Any

from .. import ai
from ..timeutil import add_days, local_now, now_ms, today_str
from .daily import generate_summary, get_summary
from .school import get_school, is_service_day
from .trips import complete_trip, trips_on

log = logging.getLogger("itransport.cron")

ABANDONED_AFTER_MS = 6 * 60 * 60_000
EVENING_SUMMARY_HOUR = 20


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
    closed = await close_abandoned_trips()
    summarized = await write_evening_summary()
    log.info("cron tick: closed=%s summary=%s", closed, summarized)
    return {"closedTrips": closed, "summaryWritten": summarized}
