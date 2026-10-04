"""Creating users and resetting passwords (usernames are unique, case-insensitive)."""

from __future__ import annotations

from typing import Any

from google.cloud import firestore

from .. import push
from ..db import USERNAMES, USERS, get_db
from ..errors import conflict, not_found
from ..security import generate_temp_password, hash_password_async
from ..timeutil import now_ms


def normalize_username(username: str) -> str:
    return username.strip().lower()


def public_user(uid: str, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": uid,
        "username": data.get("username", ""),
        "name": data.get("name", ""),
        "role": data.get("role", ""),
        "mobile": data.get("mobile", ""),
        "active": data.get("active", True),
        "mustChangePassword": bool(data.get("mustChangePassword")),
        "busIds": data.get("busIds") or [],
        "lastLoginAt": data.get("lastLoginAt"),
        "createdAt": data.get("createdAt"),
    }


async def create_user(
    *,
    name: str,
    username: str,
    role: str,
    mobile: str = "",
    bus_ids: list[str] | None = None,
    password: str | None = None,
) -> tuple[str, str]:
    """Create a user and return (user_id, temporary_password)."""
    temp = password or generate_temp_password()
    password_hash = await hash_password_async(temp)
    lower = normalize_username(username)
    db = get_db()
    user_ref = db.collection(USERS).document()
    name_ref = db.collection(USERNAMES).document(lower)
    now = now_ms()

    @firestore.async_transactional
    async def create(transaction: firestore.AsyncTransaction) -> None:
        if (await name_ref.get(transaction=transaction)).exists:
            raise conflict(f"The username “{lower}” is already taken.", "username_taken")
        transaction.set(name_ref, {"userId": user_ref.id})
        transaction.set(
            user_ref,
            {
                "username": lower,
                "name": name.strip(),
                "role": role,
                "mobile": mobile.strip(),
                "busIds": bus_ids or [],
                "active": True,
                "passwordHash": password_hash,
                "mustChangePassword": True,
                "tokenVersion": 0,
                "failedLogins": 0,
                "lockedUntil": 0,
                "lastLoginAt": None,
                "createdAt": now,
                "updatedAt": now,
            },
        )

    await create(db.transaction())
    return user_ref.id, temp


async def reset_password(user_id: str) -> str:
    """New temporary password; signs the person out everywhere and stops their alerts."""
    temp = generate_temp_password()
    password_hash = await hash_password_async(temp)
    ref = get_db().collection(USERS).document(user_id)
    snap = await ref.get()
    if not snap.exists:
        raise not_found("User")
    await ref.update(
        {
            "passwordHash": password_hash,
            "mustChangePassword": True,
            "tokenVersion": firestore.Increment(1),
            "failedLogins": 0,
            "lockedUntil": 0,
            "updatedAt": now_ms(),
        }
    )
    await push.delete_user_subscriptions(user_id)
    return temp
