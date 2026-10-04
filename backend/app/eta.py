"""ETAs from the Google Maps Routes API, with a distance-based fallback."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx

from .geo import DWELL_MS, Fix, estimate_etas

log = logging.getLogger("itransport.eta")

ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
FIELD_MASK = "routes.duration,routes.legs.duration,routes.polyline.encodedPolyline"
MAX_TARGETS = 26  # origin -> 25 intermediates -> destination


@dataclass(frozen=True)
class EtaResult:
    etas: dict[str, int]
    polyline: str | None
    source: str  # "routes" | "estimate"


def _waypoint(lat: float, lng: float, heading: float | None = None) -> dict[str, Any]:
    location: dict[str, Any] = {"latLng": {"latitude": lat, "longitude": lng}}
    if heading is not None:
        location["heading"] = int(heading) % 360
    return {"location": location}


def _duration_ms(value: str | None) -> int:
    if not value or not value.endswith("s"):
        return 0
    try:
        return int(float(value[:-1]) * 1000)
    except ValueError:
        return 0


def build_request(origin: Fix, targets: list[dict[str, Any]]) -> dict[str, Any]:
    stopover = [
        {**_waypoint(float(s["lat"]), float(s["lng"])), "vehicleStopover": True} for s in targets
    ]
    body: dict[str, Any] = {
        "origin": _waypoint(origin.lat, origin.lng, origin.heading),
        "destination": stopover[-1],
        "travelMode": "DRIVE",
        "routingPreference": "TRAFFIC_AWARE",
        "polylineQuality": "OVERVIEW",
        "languageCode": "en-IN",
        "units": "METRIC",
    }
    if len(stopover) > 1:
        body["intermediates"] = stopover[:-1]
    return body


def parse_response(
    data: dict[str, Any], targets: list[dict[str, Any]], now: int
) -> tuple[dict[str, int], str | None, int] | None:
    routes = data.get("routes") or []
    if not routes:
        return None
    legs = routes[0].get("legs") or []
    if len(legs) != len(targets):
        return None
    etas: dict[str, int] = {}
    t = now
    for i, (leg, stop) in enumerate(zip(legs, targets, strict=True)):
        t += _duration_ms(leg.get("duration"))
        if i > 0:
            t += DWELL_MS
        etas[stop["id"]] = t
    polyline = (routes[0].get("polyline") or {}).get("encodedPolyline")
    return etas, polyline, t


async def compute_etas(
    http: httpx.AsyncClient | None,
    api_key: str,
    origin: Fix,
    remaining: list[dict[str, Any]],
    now: int,
) -> EtaResult:
    if not remaining:
        return EtaResult({}, None, "routes" if api_key else "estimate")

    if api_key and http is not None:
        targets = remaining[:MAX_TARGETS]
        try:
            resp = await http.post(
                ROUTES_URL,
                json=build_request(origin, targets),
                headers={"X-Goog-Api-Key": api_key, "X-Goog-FieldMask": FIELD_MASK},
                timeout=8.0,
            )
            if resp.status_code == 200:
                parsed = parse_response(resp.json(), targets, now)
                if parsed:
                    etas, polyline, last_t = parsed
                    tail = remaining[len(targets) :]
                    if tail:
                        last = targets[-1]
                        etas.update(
                            estimate_etas(
                                (float(last["lat"]), float(last["lng"])), tail, last_t + DWELL_MS
                            )
                        )
                    return EtaResult(etas, polyline, "routes")
            log.warning("Routes API returned %s: %s", resp.status_code, resp.text[:300])
        except httpx.HTTPError as exc:
            log.warning("Routes API request failed: %s", exc)

    return EtaResult(estimate_etas((origin.lat, origin.lng), remaining, now), None, "estimate")
