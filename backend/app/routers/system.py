"""Public config, health, push subscriptions and the scheduled tick."""

from __future__ import annotations

import hmac
from typing import Any

from fastapi import APIRouter, Depends, Header, Request

from .. import push
from ..config import get_settings
from ..deps import CurrentUser, current_user
from ..errors import ApiError
from ..schemas import PushSubscriptionBody, PushUnsubscribeBody
from ..services.cron import run_tick
from ..services.school import get_school

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/config")
async def config() -> dict[str, Any]:
    s = get_settings()
    school = await get_school()
    return {
        "schoolName": school["name"],
        "mapsKey": s.maps_browser_key or None,
        "vapidPublicKey": s.vapid_public_key or None,
    }


@router.post("/push/subscribe")
async def subscribe(
    body: PushSubscriptionBody, request: Request, user: CurrentUser = Depends(current_user)
) -> dict[str, bool]:
    if not get_settings().push_enabled:
        raise ApiError(503, "push_unavailable", "Notifications aren't set up on this server yet.")
    await push.save_subscription(
        user.id,
        body.endpoint,
        body.keys.model_dump(),
        request.headers.get("user-agent", ""),
    )
    return {"ok": True}


@router.post("/push/unsubscribe")
async def unsubscribe(
    body: PushUnsubscribeBody, user: CurrentUser = Depends(current_user)
) -> dict[str, bool]:
    await push.delete_subscription(body.endpoint, user.id)
    return {"ok": True}


@router.post("/push/test")
async def test_push(user: CurrentUser = Depends(current_user)) -> dict[str, int]:
    delivered = await push.send_to_users(
        [user.id],
        {
            "title": "Notifications are on",
            "body": "You'll hear from iTransport when the bus is close.",
            "tag": "test",
            "url": "/",
        },
    )
    return {"delivered": delivered}


@router.post("/cron/tick")
async def tick(x_cron_key: str = Header(default="")) -> dict[str, Any]:
    secret = get_settings().cron_secret
    if not secret or not hmac.compare_digest(x_cron_key, secret):
        raise ApiError(401, "unauthenticated", "Missing or wrong cron key.")
    return await run_tick()
