"""Drive a bus along its route through the real API, like a driver's phone would.

Signs in as a driver, starts the trip, streams GPS fixes along the road
(using the Routes API when MAPS_SERVER_KEY is set, straight lines otherwise),
pauses at each stop, and ends the trip.

    uv run python -m scripts.simulate_trip --base http://127.0.0.1:8077 \\
        --driver ravi --password demo-pass-2026 --direction AM
"""

from __future__ import annotations

import argparse
import math
import os
import time
from typing import Any

import httpx

EARTH_R = 6_371_000.0


def haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(min(1.0, math.sqrt(h)))


def bearing(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, la2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1])
    y = math.sin(dl) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def decode_polyline(encoded: str) -> list[tuple[float, float]]:
    points, index, lat, lng = [], 0, 0, 0
    while index < len(encoded):
        for is_lng in (False, True):
            shift = result = 0
            while True:
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if is_lng:
                lng += delta
            else:
                lat += delta
        points.append((lat / 1e5, lng / 1e5))
    return points


def road_path(stops: list[dict[str, Any]], key: str | None) -> list[tuple[float, float]]:
    coords = [(s["lat"], s["lng"]) for s in stops]
    if key and len(coords) >= 2:
        body = {
            "origin": {
                "location": {"latLng": {"latitude": coords[0][0], "longitude": coords[0][1]}}
            },
            "destination": {
                "location": {"latLng": {"latitude": coords[-1][0], "longitude": coords[-1][1]}}
            },
            "intermediates": [
                {"location": {"latLng": {"latitude": la, "longitude": ln}}}
                for la, ln in coords[1:-1]
            ],
            "travelMode": "DRIVE",
            "polylineQuality": "HIGH_QUALITY",
        }
        resp = httpx.post(
            "https://routes.googleapis.com/directions/v2:computeRoutes",
            json=body,
            headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": "routes.polyline.encodedPolyline"},
            timeout=15,
        )
        if resp.status_code == 200 and resp.json().get("routes"):
            print("Following real roads from the Routes API.")
            return decode_polyline(resp.json()["routes"][0]["polyline"]["encodedPolyline"])
        print(f"Routes API unavailable ({resp.status_code}); using straight lines.")
    return coords


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--base", default="http://127.0.0.1:8077")
    parser.add_argument("--driver", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--bus", help="bus number (defaults to the driver's first bus)")
    parser.add_argument("--direction", choices=["AM", "PM"], default="AM")
    parser.add_argument("--speed", type=float, default=12.0, help="metres per second (max ~30)")
    parser.add_argument("--interval", type=float, default=2.0, help="seconds between fixes")
    parser.add_argument("--dwell", type=float, default=6.0, help="seconds to wait at each stop")
    parser.add_argument("--no-end", action="store_true", help="leave the trip running at the end")
    args = parser.parse_args()

    base = args.base.rstrip("/")
    client = httpx.Client(base_url=base, timeout=20, headers={"Origin": base})
    r = client.post("/api/auth/login", json={"username": args.driver, "password": args.password})
    r.raise_for_status()
    home = client.get("/api/driver/home").json()
    buses = home["buses"]
    bus = (
        next((b for b in buses if b["number"] == args.bus), None)
        if args.bus
        else (buses[0] if buses else None)
    )
    if not bus:
        raise SystemExit("No bus found for this driver.")

    r = client.post(
        "/api/driver/trips/start", json={"busId": bus["id"], "direction": args.direction}
    )
    if r.status_code != 200:
        raise SystemExit(f"Couldn't start the trip: {r.text}")
    trip_id = r.json()["tripId"]
    state = client.get(f"/api/driver/trips/{trip_id}").json()
    stops = state["trip"]["stops"]
    print(f"Started trip {trip_id} on Bus {bus['number']} with {len(stops)} stops.")

    path = road_path(stops, os.environ.get("MAPS_SERVER_KEY"))
    step = max(5.0, args.speed * args.interval)
    position = path[0]
    stop_coords = {(s["lat"], s["lng"]) for s in stops}

    def send(point: tuple[float, float], heading: float) -> None:
        fix = {
            "lat": point[0],
            "lng": point[1],
            "accuracy": 8,
            "at": int(time.time() * 1000),
            "speed": args.speed,
            "heading": round(heading, 1),
        }
        resp = client.post(f"/api/driver/trips/{trip_id}/locations", json={"fixes": [fix]})
        body = resp.json()
        nxt = body.get("nextStopId")
        name = next((s["name"] for s in stops if s["id"] == nxt), "—")
        eta = body.get("nextStopEta")
        mins = f"{max(0, round((eta / 1000 - time.time()) / 60))} min" if eta else "?"
        print(
            f"  {point[0]:.5f},{point[1]:.5f}  accepted={body.get('accepted')}  next={name} ({mins})"
        )

    send(position, 0)
    for target in path[1:]:
        heading = bearing(position, target)
        distance = haversine(position, target)
        hops = max(1, math.ceil(distance / step))
        for i in range(1, hops + 1):
            time.sleep(args.interval)
            t = i / hops
            point = (
                position[0] + (target[0] - position[0]) * t,
                position[1] + (target[1] - position[1]) * t,
            )
            send(point, heading)
        position = target
        if any(haversine(position, c) < 40 for c in stop_coords):
            time.sleep(args.dwell)

    if not args.no_end:
        client.post(f"/api/driver/trips/{trip_id}/end").raise_for_status()
        print("Trip ended.")


if __name__ == "__main__":
    main()
