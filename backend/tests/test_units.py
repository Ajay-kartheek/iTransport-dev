import re

from app.routers.ingest import parse_osmand
from app.security import (
    create_session_token,
    decode_session_token,
    generate_temp_password,
    hash_password,
    password_problem,
    verify_password,
)
from app.services.school import DEFAULTS, is_service_day, reminder_at_ms, upcoming_service_days
from app.timeutil import add_days, cutoff_ms, default_direction, local_ms, today_str


def test_ist_wall_clock_conversion() -> None:
    # 2026-10-05 06:30 IST == 2026-10-05 01:00 UTC
    assert local_ms("2026-10-05", "06:30") == 1_791_162_000_000
    assert today_str(1_791_162_000_000) == "2026-10-05"
    # 23:00 UTC is already the next day in India
    assert today_str(1_791_162_000_000 + 22 * 3_600_000) == "2026-10-06"


def test_direction_and_cutoffs() -> None:
    morning = local_ms("2026-10-05", "07:15")
    afternoon = local_ms("2026-10-05", "14:00")
    assert default_direction(morning) == "AM"
    assert default_direction(afternoon) == "PM"
    assert cutoff_ms("2026-10-05", "PM", "06:30", "12:30") == local_ms("2026-10-05", "12:30")


def test_service_days_and_reminders() -> None:
    school = {**DEFAULTS, "serviceDays": [1, 2, 3, 4, 5], "holidays": ["2026-10-07"]}
    assert is_service_day(school, "2026-10-05")  # Monday
    assert not is_service_day(school, "2026-10-04")  # Sunday
    assert not is_service_day(school, "2026-10-07")  # holiday
    assert upcoming_service_days(school, "2026-10-04", 3) == [
        "2026-10-05",
        "2026-10-06",
        "2026-10-08",
    ]
    assert reminder_at_ms(school, "2026-10-06", "AM") == local_ms("2026-10-05", "19:00")
    assert add_days("2026-12-31", 1) == "2027-01-01"


def test_passwords_and_sessions() -> None:
    stored = hash_password("correct horse")
    assert verify_password(stored, "correct horse")
    assert not verify_password(stored, "wrong")
    assert not verify_password(None, "anything")
    assert password_problem("short", "x") is not None
    assert password_problem("parent.one", "Parent.One") is not None
    assert password_problem("aaaaaaaaaa", "x") is not None
    assert password_problem("Sunrise-Bus-42", "parent.one") is None
    assert re.fullmatch(r"[A-Z][a-z]+-\d{4}-[a-z]+", generate_temp_password())

    token = create_session_token("u1", "PARENT", 3)
    claims = decode_session_token(token)
    assert claims and claims["sub"] == "u1" and claims["ver"] == 3
    assert decode_session_token(token + "x") is None


def test_parse_osmand_query_and_json() -> None:
    device, fix = parse_osmand(
        {"id": "key1", "lat": "13.05", "lon": "80.21", "timestamp": "1791162000", "speed": "10"},
        b"",
    )
    assert device == "key1" and fix is not None
    assert fix.at == 1_791_162_000_000
    assert abs((fix.speed or 0) - 5.14444) < 1e-3

    body = (
        b'{"device_id":"key2","location":{"timestamp":"2026-10-05T01:00:00Z",'
        b'"coords":{"latitude":13.05,"longitude":80.21,"accuracy":12,"speed":4,"heading":90}}}'
    )
    device, fix = parse_osmand({}, body)
    assert device == "key2" and fix is not None
    assert fix.at == 1_791_162_000_000 and fix.accuracy == 12 and fix.heading == 90
