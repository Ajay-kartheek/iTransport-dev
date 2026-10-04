"""Append-only audit trail of who changed what."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from .db import AUDIT, get_db
from .deps import CurrentUser
from .timeutil import now_ms

log = logging.getLogger("itransport.audit")

RETENTION_DAYS = 400


async def record(
    actor: CurrentUser | None,
    action: str,
    target_type: str,
    target_id: str,
    details: dict[str, Any] | None = None,
) -> None:
    entry = {
        "at": now_ms(),
        "actorId": actor.id if actor else None,
        "actorName": actor.name if actor else "System",
        "actorRole": actor.role if actor else "SYSTEM",
        "action": action,
        "targetType": target_type,
        "targetId": target_id,
        "details": details or {},
        "expireAt": datetime.now(UTC) + timedelta(days=RETENTION_DAYS),
    }
    try:
        await get_db().collection(AUDIT).add(entry)
    except Exception:  # an audit failure must never break the user's action
        log.exception("Failed to write audit entry %s %s/%s", action, target_type, target_id)
