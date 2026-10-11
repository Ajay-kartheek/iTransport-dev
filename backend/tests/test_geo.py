from app.eta import build_request, parse_response
from app.geo import (
    DWELL_MS,
    Fix,
    check_fix,
    estimate_etas,
    haversine_m,
    is_stale,
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
