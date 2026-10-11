"""Stop progress, including a replay of a real drive (tests/fixtures/drive_ten_stops.json)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.geo import Fix, haversine_m
from app.progress import LEFT_ORIGIN_M, flipped, record_visits, resolve

DRIVE = json.loads((Path(__file__).parent / "fixtures" / "drive_ten_stops.json").read_text())
RADIUS = float(DRIVE["radius_m"])
CAMPUS = DRIVE["campus"]
LISTED = DRIVE["stops"]  # stop 1 is next to the campus, stop 10 is farthest away


def replay(
    stops: list[dict[str, Any]],
    fixes: list[Fix],
    *,
    direction: str,
    batch: int = 4,
    started_at: int | None = None,
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]], list[int]]:
    """Feed fixes in phone-sized batches, like ingest does. Returns (order, progress, flip times)."""
    stops = [dict(s) for s in stops]
    fixed: dict[str, dict[str, Any]] = {}
    if direction == "PM" and stops[0]["kind"] == "school":
        at = started_at if started_at is not None else fixes[0].at
        fixed = {stops[0]["id"]: {"arrivedAt": at, "departedAt": at, "skipped": False}}
    visits: dict[str, list[dict[str, Any]]] = {}
    progress: dict[str, dict[str, Any]] = dict(fixed)
    prev: Fix | None = None
    flips: list[int] = []
    for i in range(0, len(fixes), batch):
        for fix in fixes[i : i + batch]:
            record_visits(stops, visits, prev, fix, RADIUS)
            prev = fix
        outcome = resolve(stops, visits, direction=direction, fixed=fixed)
        if outcome.flipped:
            flips.append(fixes[min(i + batch, len(fixes)) - 1].at)
        stops, progress = outcome.stops, outcome.progress
    return stops, progress, flips


def drive_fixes() -> list[Fix]:
    return [Fix(lat=f[0], lng=f[1], at=f[2], accuracy=f[3]) for f in DRIVE["fixes"]]


def states(stops: list[dict[str, Any]], progress: dict[str, dict[str, Any]]) -> dict[str, str]:
    out = {}
    for stop in stops:
        state = progress.get(stop["id"]) or {}
        out[stop["name"]] = (
            "reached" if state.get("arrivedAt") else "passed" if state.get("skipped") else "ahead"
        )
    return out


EVERY_STOP_BUT_6 = {f"Stop {i}": "reached" for i in range(1, 11)} | {"Stop 6": "passed"}


# ---------------------------------------------------------------- the real drive


def test_real_drive_in_the_order_the_stops_were_driven() -> None:
    stops, progress, flips = replay([CAMPUS, *LISTED], drive_fixes(), direction="PM")
    assert flips == []
    assert states(stops, progress) == {"Campus": "reached", **EVERY_STOP_BUT_6}
    # Arrival times follow the road, one stop after another.
    times = [progress[s["id"]]["arrivedAt"] for s in LISTED if s["name"] != "Stop 6"]
    assert times == sorted(times)


def test_real_drive_against_the_planned_order_switches_the_order() -> None:
    """The live failure: the afternoon trip expected stop 10 first, the bus went to stop 1."""
    planned = [CAMPUS, *reversed(LISTED)]
    stops, progress, flips = replay(planned, drive_fixes(), direction="PM")
    assert len(flips) == 1
    assert [s["name"] for s in stops] == ["Campus", *[f"Stop {i}" for i in range(1, 11)]]
    assert states(stops, progress) == {"Campus": "reached", **EVERY_STOP_BUT_6}
    # It switched as soon as the bus had done two stops in its own order.
    stop_2_at = progress["s2"]["arrivedAt"]
    assert flips[0] - stop_2_at < 2 * 60_000


@pytest.mark.parametrize("batch", [1, 3, 10, 200])
def test_batching_does_not_change_the_outcome(batch: int) -> None:
    stops, progress, _ = replay(
        [CAMPUS, *reversed(LISTED)], drive_fixes(), direction="PM", batch=batch
    )
    assert states(stops, progress) == {"Campus": "reached", **EVERY_STOP_BUT_6}


def test_parked_at_school_nothing_happens() -> None:
    parked = [f for f in drive_fixes() if f.at < DRIVE["started_at"] + 25 * 60_000]
    stops, progress, _ = replay([CAMPUS, *LISTED], parked, direction="PM")
    assert states(stops, progress)["Stop 1"] == "ahead"


def test_empty_morning_bus_heading_out_past_its_stops_counts_none() -> None:
    """Morning order runs 10 -> 1 -> school; the same drive is the bus heading out to stop 10."""
    morning = [*reversed(LISTED), CAMPUS]
    stops, progress, flips = replay(morning, drive_fixes(), direction="AM")
    assert flips == []
    result = states(stops, progress)
    assert result.pop("Stop 10") == "reached"  # its first pickup, reached at the end of the drive
    assert set(result.values()) == {"ahead"}


# ---------------------------------------------------------------- synthetic routes

BASE = 1_800_000_000_000
LNG = 80.2000


def stop(name: str, lat: float, lng: float = LNG, kind: str = "stop") -> dict[str, Any]:
    out = {"id": name, "name": name, "lat": lat, "lng": lng, "kind": kind}
    if kind == "school":
        out["campusId"] = name
    return out


ROUTE = [stop(f"S{i}", 13.0 + i * 0.01) for i in range(1, 7)]  # 1.1 km apart, northwards
SCHOOL = stop("school", 13.07, kind="school")  # just past S6


def drive(
    points: list[tuple[float, float]], *, start: int = BASE, step_ms: int = 8_000
) -> list[Fix]:
    """Fixes about every 50 m along straight lines between points (like the phone sends)."""
    fixes = [Fix(lat=points[0][0], lng=points[0][1], at=start, accuracy=5)]
    at = start
    for (lat1, lng1), (lat2, lng2) in zip(points, points[1:], strict=False):
        metres = haversine_m(lat1, lng1, lat2, lng2)
        hops = max(1, round(metres / 50))
        for h in range(1, hops + 1):
            at += step_ms
            u = h / hops
            fixes.append(
                Fix(lat=lat1 + (lat2 - lat1) * u, lng=lng1 + (lng2 - lng1) * u, at=at, accuracy=5)
            )
    return fixes


def wait(fixes: list[Fix], seconds: int) -> list[Fix]:
    """Stand still where the last fix is (the phone records every 15 s)."""
    last = fixes[-1]
    return fixes + [
        Fix(lat=last.lat, lng=last.lng, at=last.at + s * 1000, accuracy=5)
        for s in range(15, seconds + 1, 15)
    ]


def test_stop_pinned_off_the_road_is_passed_and_the_trip_carries_on() -> None:
    off_road = [*ROUTE[:2], stop("S3", 13.03, LNG + 0.003), *ROUTE[3:], SCHOOL]  # ~325 m east
    fixes = drive([(12.995, LNG), (13.075, LNG)])
    stops, progress, _ = replay(off_road, fixes, direction="AM")
    result = states(stops, progress)
    assert result["S3"] == "passed"
    assert all(result[s] == "reached" for s in ("S1", "S2", "S4", "S5", "S6"))


def test_a_long_gap_between_fixes_still_catches_stops_on_the_way() -> None:
    fixes = drive([(12.995, LNG), (13.075, LNG)], step_ms=8_000)
    sparse = fixes[::12]  # one fix every ~600 m
    stops, progress, _ = replay([*ROUTE, SCHOOL], sparse, direction="AM")
    assert all(v == "reached" for k, v in states(stops, progress).items() if k != "school")


def test_lost_signal_for_several_stops_picks_up_where_the_bus_is() -> None:
    fixes = drive([(12.995, LNG), (13.075, LNG)])
    gap_from, gap_to = 13.015, 13.045  # no fixes between S1 and S5 (phone locked)
    patchy = [f for f in fixes if not gap_from < f.lat < gap_to]
    stops, progress, _ = replay([*ROUTE, SCHOOL], patchy, direction="AM")
    result = states(stops, progress)
    assert result["S1"] == "reached" and result["S5"] == "reached" and result["S6"] == "reached"
    assert result["S2"] == result["S3"] == result["S4"] == "passed"


def test_starting_parked_next_to_a_later_stop_counts_nothing() -> None:
    parked = wait(drive([(13.04, LNG), (13.0401, LNG)]), 600)  # 10 minutes beside S4
    stops, progress, _ = replay([*ROUTE, SCHOOL], parked, direction="AM")
    assert set(states(stops, progress).values()) == {"ahead"}


def test_starting_mid_route_counts_from_two_stops_in_order() -> None:
    fixes = drive([(13.015, LNG), (13.075, LNG)])  # starts after S1
    stops, progress, _ = replay([*ROUTE, SCHOOL], fixes, direction="AM")
    result = states(stops, progress)
    assert result["S1"] == "passed"
    assert all(result[s] == "reached" for s in ("S2", "S3", "S4", "S5", "S6"))


def test_morning_school_counts_only_after_a_pickup_and_a_proper_stop() -> None:
    # Parked at school before setting off: not "reached school".
    at_school = wait(drive([(13.07, LNG), (13.0701, LNG)]), 300)
    stops, progress, _ = replay([*ROUTE, SCHOOL], at_school, direction="AM")
    assert states(stops, progress)["school"] == "ahead"

    # Picks up, then drives straight through the school gate without stopping: not yet.
    through = drive([(12.995, LNG), (13.09, LNG)])
    stops, progress, _ = replay([*ROUTE, SCHOOL], through, direction="AM")
    assert states(stops, progress)["school"] == "ahead"

    # Picks up and stops at school: reached.
    stops, progress, _ = replay(
        [*ROUTE, SCHOOL], wait(drive([(12.995, LNG), (13.07, LNG)]), 60), direction="AM"
    )
    assert states(stops, progress)["school"] == "reached"


def test_morning_bus_running_its_stops_backwards_switches_only_once_it_stops_at_them() -> None:
    planned = [*ROUTE, SCHOOL]  # S1 first
    points = [(13.065, LNG), (13.06, LNG)]
    fixes = drive(points)
    for target in (13.05, 13.04, 13.03, 13.02, 13.01):  # stop ~30 s at S5, S4, S3, S2, S1
        fixes = wait(fixes, 30)
        fixes += drive([(fixes[-1].lat, LNG), (target, LNG)], start=fixes[-1].at)[1:]
    stops, progress, flips = replay(planned, wait(fixes, 30), direction="AM")
    assert len(flips) == 1
    assert [s["name"] for s in stops][:6] == ["S6", "S5", "S4", "S3", "S2", "S1"]
    assert all(v == "reached" for k, v in states(stops, progress).items() if k != "school")


def test_afternoon_with_two_campuses_collects_at_the_second_before_dropping_off() -> None:
    main, junior = stop("main", 12.98, kind="school"), stop("junior", 12.99, kind="school")
    planned = [main, junior, *ROUTE]
    fixes = drive([(12.98, LNG), (13.065, LNG)])
    stops, progress, _ = replay(planned, fixes, direction="PM")
    result = states(stops, progress)
    assert result == {"main": "reached", "junior": "reached"} | {
        f"S{i}": "reached" for i in range(1, 7)
    }


def test_flipping_keeps_campuses_where_they_are() -> None:
    order = [stop("c1", 0, kind="school"), *ROUTE[:3], stop("c2", 0, kind="school")]
    assert [s["id"] for s in flipped(order)] == ["c1", "S3", "S2", "S1", "c2"]


def test_set_off_distance_is_sensible() -> None:
    assert 200 <= LEFT_ORIGIN_M <= 800


def test_afternoon_bus_heading_to_the_far_end_first_switches_without_marking_stops_passed() -> None:
    """Planned near-first; the bus drives out to the far stop (passing N3), then drops off back."""
    main, junior = stop("main", 12.98, kind="school"), stop("junior", 12.99, kind="school")
    n1, n2, n3 = stop("N1", 12.99, LNG + 0.01), stop("N2", 12.99, LNG + 0.02), stop("N3", 13.01)
    far = stop("F", 13.03)
    planned = [main, junior, n1, n2, n3, far]  # N1 and N2 lie east of the junior campus
    out = drive([(12.98, LNG), (12.99, LNG), (13.03, LNG)])  # junior, then north past N3 to F
    back = drive(
        [(13.03, LNG), (13.01, LNG), (12.99, LNG + 0.02), (12.99, LNG + 0.01)],
        start=out[-1].at,
    )[1:]
    stops, progress, flips = replay(planned, out, direction="PM")
    # At the far end: it has switched rather than claiming N1 and N2 were passed.
    assert len(flips) == 1
    assert states(stops, progress) == {
        "main": "reached",
        "junior": "reached",
        "F": "reached",
        "N3": "ahead",
        "N2": "ahead",
        "N1": "ahead",
    }
    stops, progress, _ = replay(planned, out + back, direction="PM")
    assert [s["name"] for s in stops] == ["main", "junior", "F", "N3", "N2", "N1"]
    assert set(states(stops, progress).values()) == {"reached"}
