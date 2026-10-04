"""School-local time helpers. All stored times are epoch milliseconds (UTC)."""

from __future__ import annotations

import re
import time
from datetime import date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

Direction = Literal["AM", "PM"]
DIRECTIONS: tuple[Direction, ...] = ("AM", "PM")

TZ = ZoneInfo("Asia/Kolkata")
_HHMM = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# The afternoon (PM) trip becomes the default view from this local time.
PM_SWITCH = (12, 0)


def now_ms() -> int:
    return int(time.time() * 1000)


def local_now(ms: int | None = None) -> datetime:
    ms = now_ms() if ms is None else ms
    return datetime.fromtimestamp(ms / 1000, TZ)


def today_str(ms: int | None = None) -> str:
    return local_now(ms).date().isoformat()


def is_date_str(value: str) -> bool:
    if not _DATE.match(value):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def add_days(date_str: str, days: int) -> str:
    return (date.fromisoformat(date_str) + timedelta(days=days)).isoformat()


def is_hhmm(value: str) -> bool:
    return bool(_HHMM.match(value))


def local_ms(date_str: str, hhmm: str) -> int:
    """Epoch ms for a school-local wall-clock time on a date."""
    hour, minute = (int(x) for x in hhmm.split(":"))
    d = date.fromisoformat(date_str)
    dt = datetime(d.year, d.month, d.day, hour, minute, tzinfo=TZ)
    return int(dt.timestamp() * 1000)


def default_direction(ms: int | None = None) -> Direction:
    now = local_now(ms)
    return "AM" if (now.hour, now.minute) < PM_SWITCH else "PM"


def cutoff_ms(date_str: str, direction: Direction, am_cutoff: str, pm_cutoff: str) -> int:
    return local_ms(date_str, am_cutoff if direction == "AM" else pm_cutoff)


def day_label(date_str: str, today: str) -> str:
    if date_str == today:
        return "Today"
    if date_str == add_days(today, 1):
        return "Tomorrow"
    return date.fromisoformat(date_str).strftime("%a")
