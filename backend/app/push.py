"""Web push notifications (VAPID), sent straight to each browser's push service."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from typing import Any

from google.cloud.firestore import FieldFilter
from py_vapid import Vapid02
from pywebpush import WebPushException, webpush_async

from .config import get_settings
from .db import PUSH_SUBS, USERS, get_db
from .timeutil import now_ms

log = logging.getLogger("itransport.push")

_vapid: Vapid02 | None = None
_SEND_CONCURRENCY = 10


def subscription_id(endpoint: str) -> str:
    return hashlib.sha256(endpoint.encode()).hexdigest()[:40]


def _get_vapid() -> Vapid02 | None:
    global _vapid
    s = get_settings()
    if not s.push_enabled:
        return None
    if _vapid is None:
        _vapid = Vapid02.from_string(s.vapid_private_key)
    return _vapid


async def save_subscription(user_id: str, endpoint: str, keys: dict[str, str], ua: str) -> None:
    await (
        get_db()
        .collection(PUSH_SUBS)
        .document(subscription_id(endpoint))
        .set(
            {"userId": user_id, "endpoint": endpoint, "keys": keys, "ua": ua[:200], "at": now_ms()}
        )
    )


async def delete_subscription(endpoint: str, user_id: str | None = None) -> None:
    ref = get_db().collection(PUSH_SUBS).document(subscription_id(endpoint))
    if user_id is not None:
        snap = await ref.get()
        if not snap.exists or (snap.to_dict() or {}).get("userId") != user_id:
            return
    await ref.delete()


async def delete_user_subscriptions(user_id: str) -> None:
    """Stop all alerts to a person's devices (used when they're disabled or reset)."""
    query = get_db().collection(PUSH_SUBS).where(filter=FieldFilter("userId", "==", user_id))
    async for snap in query.stream():
        await snap.reference.delete()


async def _active_users(user_ids: list[str]) -> set[str]:
    db = get_db()
    refs = [db.collection(USERS).document(uid) for uid in set(user_ids)]
    active: set[str] = set()
    async for snap in db.get_all(refs):
        if snap.exists and (snap.to_dict() or {}).get("active", True):
            active.add(snap.id)
    return active


async def _subscriptions_for(user_ids: list[str]) -> list[dict[str, Any]]:
    subs: list[dict[str, Any]] = []
    unique = sorted(set(user_ids))
    for i in range(0, len(unique), 30):  # Firestore "in" queries take up to 30 values
        query = (
            get_db()
            .collection(PUSH_SUBS)
            .where(filter=FieldFilter("userId", "in", unique[i : i + 30]))
        )
        async for snap in query.stream():
            subs.append({"id": snap.id, **(snap.to_dict() or {})})
    return subs


async def send_to_users(user_ids: list[str], payload: dict[str, Any], ttl: int = 900) -> int:
    """Send the same notification to every device of these users. Returns deliveries."""
    return await send_each({uid: payload for uid in user_ids}, ttl=ttl)


async def send_each(messages: dict[str, dict[str, Any]], ttl: int = 900) -> int:
    """Send a per-user notification to each user's devices. Returns deliveries."""
    vapid = _get_vapid()
    if vapid is None or not messages:
        return 0
    active = await _active_users(list(messages))
    subs = await _subscriptions_for([uid for uid in messages if uid in active])
    if not subs:
        return 0

    subject = get_settings().vapid_subject
    gate = asyncio.Semaphore(_SEND_CONCURRENCY)

    async def deliver(sub: dict[str, Any]) -> bool:
        async with gate:
            try:
                await webpush_async(
                    subscription_info={"endpoint": sub["endpoint"], "keys": sub["keys"]},
                    data=json.dumps(messages[sub["userId"]]),
                    vapid_private_key=vapid,
                    # pywebpush writes "aud" into this dict, so each send needs its own copy.
                    vapid_claims={"sub": subject},
                    ttl=ttl,
                    headers={"Urgency": "high"},
                    timeout=10,
                )
                return True
            except WebPushException as exc:
                status = getattr(exc.response, "status", None) or getattr(
                    exc.response, "status_code", None
                )
                if status in (404, 410):
                    await get_db().collection(PUSH_SUBS).document(sub["id"]).delete()
                else:
                    log.warning("Push to %s failed: %s", sub["endpoint"][:60], exc)
            except Exception:
                log.exception("Push delivery crashed")
            return False

    results = await asyncio.gather(*(deliver(s) for s in subs))
    return sum(1 for ok in results if ok)
