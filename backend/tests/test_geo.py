from app.eta import build_request, parse_response
from app.geo import (
    DWELL_MS,
    Fix,
    advance_progress,
    check_fix,
    current_stop_id,
    estimate_etas,
    haversine_m,
    is_stale,
    pending_stops,
)

NOW = 1_800_000_000_000
STOPS = [
    {"id": "a", "lat": 13.0000, "lng": 80.2000, "kind": "stop"},
    {"id": "b", "lat": 13.0100, "lng": 80.2000, "kind": "stop"},
    {"id": "c", "lat": 13.0200, "lng": 80.2000, "kind": "stop"},
    {"id": "school", "lat": 13.0300, "lng": 80.2000, "kind": "school"},
]


def fix(lat: float, lng: float = 80.2, at: int = NOW, acc: float = 10) -> Fix:
    return Fix(lat=lat, lng=lng, at=at, accuracy=acc)


def test_haversine_one_hundredth_degree_latitude_is_about_1112_m() -> None:
    assert 1105 < haversine_m(13.0, 80.2, 13.01, 80.2) < 1120


def test_rejects_inaccurate_future_and_out_of_order_fixes() -> None:
    kwargs = {"now": NOW, "started_at": NOW - 60_000, "jump_streak": 0}
    assert check_fix(None, fix(13.0, acc=250), **kwargs) == "inaccurate"
    assert check_fix(None, fix(13.0, at=NOW + 10 * 60_000), **kwargs) == "future"
    assert check_fix(None, fix(13.0, at=NOW - 3 * 60 * 60_000), **kwargs) == "before_start"
    assert check_fix(None, fix(0.0, 0.0), **kwargs) == "invalid"
    prev = fix(13.0, at=NOW)
    assert check_fix(prev, fix(13.0001, at=NOW - 1000), **kwargs) == "out_of_order"
    assert check_fix(None, fix(13.0), **kwargs) is None


def test_rejects_teleport_jumps_but_recovers_after_a_streak() -> None:
    prev = fix(13.0, at=NOW)
    jump = fix(13.2, at=NOW + 5_000)  # ~22 km in 5 s
    common = {"now": NOW + 10_000, "started_at": NOW - 60_000}
    assert check_fix(prev, jump, jump_streak=0, **common) == "jump"
    assert check_fix(prev, jump, jump_streak=1, **common) == "jump"
    assert check_fix(prev, jump, jump_streak=2, **common) is None  # third in a row: trust it


def test_normal_driving_speed_is_accepted() -> None:
    prev = fix(13.0, at=NOW)
    nxt = fix(13.001, at=NOW + 15_000)  # ~111 m in 15 s = 27 km/h
    assert check_fix(prev, nxt, now=NOW + 20_000, started_at=NOW - 1, jump_streak=0) is None


FAR = fix(12.99, at=NOW - 60_000)  # where the trip started: well south of every stop


def test_next_stop_is_reached_at_once_and_departed() -> None:
    progress: dict = {}
    events = advance_progress(STOPS, progress, fix(13.0002, at=NOW), radius_m=120, origin=FAR)
    assert events == [("arrived", "a")]
    assert current_stop_id(STOPS, progress) == "a"

    events = advance_progress(
        STOPS, progress, fix(13.005, at=NOW + 60_000), radius_m=120, origin=FAR
    )
    assert events == [("departed", "a")]
    assert current_stop_id(STOPS, progress) is None


def test_a_stop_further_ahead_needs_the_bus_to_stay_there() -> None:
    progress: dict = {}
    advance_progress(STOPS, progress, fix(13.0002, at=NOW), radius_m=120, origin=FAR)
    advance_progress(STOPS, progress, fix(13.005, at=NOW + 60_000), radius_m=120, origin=FAR)

    # Near "c" while "b" is still the next stop: not enough on its own...
    t = NOW + 120_000
    assert advance_progress(STOPS, progress, fix(13.0199, at=t), radius_m=120, origin=FAR) == []
    # ...but staying there confirms it, and "b" counts as passed.
    events = advance_progress(
        STOPS, progress, fix(13.0199, at=t + 25_000), radius_m=120, origin=FAR
    )
    assert events == [("skipped", "b"), ("arrived", "c")]
    assert progress["c"]["arrivedAt"] == t
    assert [s["id"] for s in pending_stops(STOPS, progress)] == ["school"]


def test_driving_past_a_later_stop_without_stopping_changes_nothing() -> None:
    progress: dict = {}
    assert advance_progress(STOPS, progress, fix(13.0101, at=NOW), radius_m=120, origin=FAR) == []
    assert (
        advance_progress(STOPS, progress, fix(13.0150, at=NOW + 15_000), radius_m=120, origin=FAR)
        == []
    )
    events = advance_progress(
        STOPS, progress, fix(13.0001, at=NOW + 90_000), radius_m=120, origin=FAR
    )
    assert events == [("arrived", "a")]
    assert [s["id"] for s in pending_stops(STOPS, progress)] == ["b", "c", "school"]


def test_a_bus_parked_at_school_does_not_finish_the_morning_trip() -> None:
    progress: dict = {}
    at_school = fix(13.0299, at=NOW)
    for i in range(4):
        events = advance_progress(
            STOPS, progress, fix(13.0299, at=NOW + i * 30_000), radius_m=120, origin=at_school
        )
        assert events == []
    assert [s["id"] for s in pending_stops(STOPS, progress)] == ["a", "b", "c", "school"]


def test_waiting_near_another_stop_at_the_start_is_ignored() -> None:
    progress: dict = {}
    near_b = fix(13.0101, at=NOW)
    for i in range(5):
        events = advance_progress(
            STOPS, progress, fix(13.0101, at=NOW + i * 20_000), radius_m=120, origin=near_b
        )
        assert events == []


def test_school_counts_after_pickups() -> None:
    progress: dict = {}
    advance_progress(STOPS, progress, fix(13.0001, at=NOW), radius_m=120, origin=FAR)
    advance_progress(STOPS, progress, fix(13.0100, at=NOW + 60_000), radius_m=120, origin=FAR)
    advance_progress(STOPS, progress, fix(13.0200, at=NOW + 120_000), radius_m=120, origin=FAR)
    events = advance_progress(
        STOPS, progress, fix(13.0300, at=NOW + 180_000), radius_m=120, origin=FAR
    )
    assert ("arrived", "school") in events
    assert pending_stops(STOPS, progress) == []


def test_fallback_etas_increase_along_the_route() -> None:
    etas = estimate_etas((12.99, 80.2), STOPS, NOW)
    times = [etas[s["id"]] for s in STOPS]
    assert times == sorted(times)
    assert times[0] > NOW
    assert times[1] - times[0] >= DWELL_MS


def test_staleness() -> None:
    assert not is_stale(None, NOW)  # no position yet is "waiting", not "lost"
    assert not is_stale(NOW - 60_000, NOW)
    assert is_stale(NOW - 180_000, NOW)


def test_routes_request_and_response_mapping() -> None:
    origin = Fix(lat=12.99, lng=80.2, at=NOW, accuracy=8, heading=10)
    body = build_request(origin, STOPS)
    assert body["origin"]["location"]["heading"] == 10
    assert len(body["intermediates"]) == 3
    assert body["destination"]["location"]["latLng"]["latitude"] == 13.03
    assert body["routingPreference"] == "TRAFFIC_AWARE"

    response = {
        "routes": [
            {
                "legs": [
                    {"duration": "60s"},
                    {"duration": "120s"},
                    {"duration": "90s"},
                    {"duration": "30s"},
                ],
                "polyline": {"encodedPolyline": "abc"},
            }
        ]
    }
    parsed = parse_response(response, STOPS, NOW)
    assert parsed is not None
    etas, polyline, _ = parsed
    assert polyline == "abc"
    assert etas["a"] == NOW + 60_000
    assert etas["b"] == NOW + 60_000 + 120_000 + DWELL_MS
    assert parse_response({"routes": [{"legs": []}]}, STOPS, NOW) is None


# Two campuses: the morning trip drops at the junior campus, then the main one.
TWO_CAMPUSES = [
    {"id": "a", "lat": 13.0000, "lng": 80.2000, "kind": "stop"},
    {"id": "b", "lat": 13.0100, "lng": 80.2000, "kind": "stop"},
    {"id": "school-jr", "lat": 13.0200, "lng": 80.2000, "kind": "school", "campusId": "jr"},
    {"id": "school-main", "lat": 13.0300, "lng": 80.2000, "kind": "school", "campusId": "main"},
]


def test_morning_campuses_count_only_after_a_pickup() -> None:
    progress: dict = {}
    parked = fix(13.0200, at=NOW)  # starts the morning parked at the junior campus
    for i in range(3):
        assert (
            advance_progress(
                TWO_CAMPUSES, progress, fix(13.02, at=NOW + i * 30_000), radius_m=120, origin=parked
            )
            == []
        )

    t = NOW + 120_000
    for lat in (13.0001, 13.0101, 13.0201, 13.0301):
        advance_progress(TWO_CAMPUSES, progress, fix(lat, at=t), radius_m=120, origin=parked)
        t += 60_000
    assert all(progress[s["id"]].get("arrivedAt") for s in TWO_CAMPUSES)
    assert pending_stops(TWO_CAMPUSES, progress) == []


def test_afternoon_collects_from_both_campuses_before_drop_offs() -> None:
    stops = list(reversed(TWO_CAMPUSES))  # main campus, junior campus, b, a
    progress: dict = {"school-main": {"arrivedAt": NOW, "departedAt": NOW, "skipped": False}}
    origin = fix(13.0300, at=NOW)
    events = advance_progress(
        stops, progress, fix(13.0201, at=NOW + 60_000), radius_m=120, origin=origin
    )
    assert events == [("arrived", "school-jr")]
    advance_progress(stops, progress, fix(13.0150, at=NOW + 120_000), radius_m=120, origin=origin)
    events = advance_progress(
        stops, progress, fix(13.0101, at=NOW + 180_000), radius_m=120, origin=origin
    )
    assert events == [("arrived", "b")]
    assert [s["id"] for s in pending_stops(stops, progress)] == ["a"]
