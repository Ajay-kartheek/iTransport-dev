"""Fallback location source: the free Traccar Client app (OsmAnd protocol).

Configure Traccar Client with server URL ``https://<host>/api/ingest/osmand``
and the bus's tracker key as the device identifier. Positions are only used
while that bus has a trip in progress.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any
from urllib.parse import parse_qsl

from fastapi import APIRouter, Request

from .. import cache
from ..db import TRIPS
from ..errors import ApiError
from ..geo import Fix
from ..ratelimit import SlidingWindowLimiter, client_ip
from ..services.trips import all_buses, get_doc, ingest_fixes, trip_id
from ..timeutil import DIRECTIONS, now_ms, today_str

log = logging.getLogger("itransport.ingest")
router = APIRouter(prefix="/api/ingest", tags=["ingest"])

KNOTS_TO_MPS = 0.514444
DEFAULT_ACCURACY_M = 50.0
_limiter = SlidingWindowLimiter(limit=240, window_s=60)


def _timestamp_ms(value: Any) -> int:
    if value in (None, ""):
        return now_ms()
    text = str(value).strip()
    try:
        number = float(text)
        return int(number if number > 1e12 else number * 1000)
    except ValueError:
        pass
    try:
        return int(datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return now_ms()


def _float(value: Any) -> float | None:
    try:
        return None if value in (None, "") else float(value)
    except (TypeError, ValueError):
        return None


def parse_osmand(params: dict[str, Any], body: bytes) -> tuple[str | None, Fix | None]:
    """Accept both the classic query/form format and Traccar Client 9's JSON format."""
    if body.strip().startswith(b"{"):
        try:
            data = json.loads(body)
        except ValueError:
            return None, None
        location = data.get("location") or {}
        coords = location.get("coords") or {}
        device = data.get("device_id") or data.get("id") or data.get("deviceid")
        lat, lng = _float(coords.get("latitude")), _float(coords.get("longitude"))
        if device is None or lat is None or lng is None:
            return (str(device) if device else None), None
        speed = _float(coords.get("speed"))
        heading = _float(coords.get("heading"))
        return str(device), Fix(
            lat=lat,
            lng=lng,
            at=_timestamp_ms(location.get("timestamp")),
            accuracy=_float(coords.get("accuracy")) or DEFAULT_ACCURACY_M,
            speed=speed if speed is not None and speed >= 0 else None,
            heading=heading if heading is not None and 0 <= heading <= 360 else None,
        )

    device = params.get("id") or params.get("deviceid")
    lat, lng = _float(params.get("lat")), _float(params.get("lon"))
    if not device or lat is None or lng is None:
        return (str(device) if device else None), None
    speed_knots = _float(params.get("speed"))
    heading = _float(params.get("bearing") or params.get("heading"))
    return str(device), Fix(
        lat=lat,
        lng=lng,
        at=_timestamp_ms(params.get("timestamp")),
        accuracy=_float(params.get("accuracy")) or DEFAULT_ACCURACY_M,
        speed=speed_knots * KNOTS_TO_MPS if speed_knots is not None else None,
        heading=heading if heading is not None and 0 <= heading <= 360 else None,
    )


async def _bus_for_key(key: str) -> dict[str, Any] | None:
    async def load() -> dict[str, Any] | None:
        return next((b for b in await all_buses() if b.get("trackerKey") == key), None)

    return await cache.cached(f"tracker:{key}", 30, load)


@router.api_route("/osmand", methods=["GET", "POST"])
async def osmand(request: Request) -> dict[str, Any]:
    if not _limiter.allow(client_ip(request)):
        raise ApiError(429, "rate_limited", "Too many updates.")
    params: dict[str, Any] = dict(request.query_params)
    body = await request.body()
    if body and not body.strip().startswith(b"{"):
        params.update(parse_qsl(body.decode("utf-8", "replace"), keep_blank_values=False))
    device, fix = parse_osmand(params, body)
    if not device:
        raise ApiError(400, "bad_request", "Missing device id.")
    bus = await _bus_for_key(device)
    if not bus or not bus.get("active", True):
        raise ApiError(401, "unknown_device", "Unknown device id.")
    if fix is None:
        raise ApiError(400, "bad_request", "Missing coordinates.")

    today = today_str()
    for direction in DIRECTIONS:
        tid = trip_id(today, direction, bus["id"])
        trip = await get_doc(TRIPS, tid)
        if trip and trip.get("status") == "in_progress":
            result = await ingest_fixes(tid, [fix], driver_id=None, http=request.app.state.http)
            return {"ok": True, "accepted": result["accepted"]}
    # No trip running: acknowledge so the app doesn't queue the point, but don't store it.
    return {"ok": True, "accepted": 0, "note": "No trip in progress; position ignored."}
