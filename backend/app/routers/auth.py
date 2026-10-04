"""Sign in, sign out, current user and password changes."""

from __future__ import annotations

import math
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from google.cloud import firestore

from .. import audit
from ..config import get_settings
from ..db import USERNAMES, USERS, get_db
from ..deps import CurrentUser, signed_in_user
from ..errors import ApiError
from ..ratelimit import SlidingWindowLimiter, client_ip
from ..schemas import ChangePasswordBody, LoginBody
from ..security import (
    SESSION_COOKIE,
    create_session_token,
    hash_password_async,
    needs_rehash,
    password_problem,
    set_session_cookie,
    valid_username,
    verify_password_async,
)
from ..services.school import get_school
from ..services.users import normalize_username
from ..timeutil import now_ms

router = APIRouter(prefix="/api/auth", tags=["auth"])

LOCK_AFTER_FAILURES = 5
LOCK_MINUTES = 15
_ip_limiter = SlidingWindowLimiter(limit=30, window_s=300)
_password_change_limiter = SlidingWindowLimiter(limit=10, window_s=900)

_WRONG = ApiError(401, "invalid_credentials", "That username and password don't match.")


def _me(user_id: str, data: dict[str, Any], school_name: str) -> dict[str, Any]:
    return {
        "id": user_id,
        "username": data.get("username", ""),
        "name": data.get("name", ""),
        "role": data.get("role", ""),
        "mustChangePassword": bool(data.get("mustChangePassword")),
        "schoolName": school_name,
    }


def _locked(until: int, now: int) -> ApiError:
    minutes = max(1, math.ceil((until - now) / 60_000))
    return ApiError(
        429,
        "locked",
        f"Too many wrong passwords. Try again in {minutes} minute{'s' if minutes > 1 else ''}.",
    )


async def _reserve_attempt(
    user_ref: firestore.AsyncDocumentReference,
) -> tuple[str, dict[str, Any] | None]:
    """Count a sign-in attempt *before* the password is checked.

    The lock check and the count happen in one transaction, so parallel guesses
    can't slip past the limit: after five attempts without a success, the next
    one locks the account. A successful sign-in resets the count.
    """

    @firestore.async_transactional
    async def reserve(
        transaction: firestore.AsyncTransaction,
    ) -> tuple[str, dict[str, Any] | None]:
        snap = await user_ref.get(transaction=transaction)
        if not snap.exists:
            return "missing", None
        data = snap.to_dict() or {}
        now = now_ms()
        if int(data.get("lockedUntil") or 0) > now:
            return "locked", data
        attempts = int(data.get("failedLogins") or 0) + 1
        if attempts > LOCK_AFTER_FAILURES:
            until = now + LOCK_MINUTES * 60_000
            transaction.update(user_ref, {"failedLogins": 0, "lockedUntil": until})
            return "locked", {**data, "lockedUntil": until}
        transaction.update(user_ref, {"failedLogins": attempts})
        return "ok", data

    return await reserve(get_db().transaction())


@router.post("/login")
async def login(body: LoginBody, request: Request, response: Response) -> dict[str, Any]:
    if not _ip_limiter.allow(client_ip(request)):
        raise ApiError(429, "rate_limited", "Too many sign-in attempts. Please wait a few minutes.")

    db = get_db()
    username = normalize_username(body.username)
    user_ref = None
    if valid_username(username):
        index = await db.collection(USERNAMES).document(username).get()
        if index.exists:
            user_ref = db.collection(USERS).document((index.to_dict() or {})["userId"])
    if user_ref is None:
        await verify_password_async(None, body.password)  # same cost as a real check
        raise _WRONG

    try:
        verdict, data = await _reserve_attempt(user_ref)
    except Exception as exc:  # contention from many parallel attempts: refuse, don't guess
        raise ApiError(
            429, "rate_limited", "Too many sign-in attempts. Please wait a moment."
        ) from exc
    now = now_ms()
    if verdict == "locked" and data is not None:
        raise _locked(int(data.get("lockedUntil") or 0), now)
    if data is None:
        await verify_password_async(None, body.password)
        raise _WRONG

    stored_hash = data.get("passwordHash")
    if not stored_hash or not await verify_password_async(stored_hash, body.password):
        raise _WRONG
    if not data.get("active", True):
        raise ApiError(
            403, "account_disabled", "This account is turned off. Please contact the school."
        )

    updates: dict[str, Any] = {"failedLogins": 0, "lockedUntil": 0, "lastLoginAt": now}
    if needs_rehash(stored_hash):
        updates["passwordHash"] = await hash_password_async(body.password)
    await user_ref.update(updates)

    set_session_cookie(
        response,
        create_session_token(user_ref.id, data["role"], int(data.get("tokenVersion", 0))),
    )
    school = await get_school()
    return {"user": _me(user_ref.id, data, school["name"])}


@router.post("/logout")
async def logout(response: Response) -> dict[str, bool]:
    s = get_settings()
    response.delete_cookie(
        SESSION_COOKIE, path="/", secure=s.cookie_secure, httponly=True, samesite="lax"
    )
    return {"ok": True}


@router.get("/me")
async def me(user: CurrentUser = Depends(signed_in_user)) -> dict[str, Any]:
    school = await get_school()
    return {
        "user": {
            "id": user.id,
            "username": user.username,
            "name": user.name,
            "role": user.role,
            "mustChangePassword": user.must_change_password,
            "schoolName": school["name"],
        }
    }


@router.post("/change-password")
async def change_password(
    body: ChangePasswordBody, response: Response, user: CurrentUser = Depends(signed_in_user)
) -> dict[str, Any]:
    if not _password_change_limiter.allow(user.id):
        raise ApiError(429, "rate_limited", "Too many attempts. Please wait a few minutes.")
    ref = get_db().collection(USERS).document(user.id)
    data = (await ref.get()).to_dict() or {}
    if not await verify_password_async(data.get("passwordHash"), body.currentPassword):
        raise ApiError(400, "wrong_password", "Your current password isn't right.")
    problem = password_problem(body.newPassword, user.username)
    if problem:
        raise ApiError(400, "weak_password", problem)
    if body.newPassword == body.currentPassword:
        raise ApiError(400, "same_password", "Choose a password you haven't used here before.")

    new_version = int(data.get("tokenVersion", 0)) + 1
    await ref.update(
        {
            "passwordHash": await hash_password_async(body.newPassword),
            "mustChangePassword": False,
            "tokenVersion": new_version,
            "updatedAt": now_ms(),
        }
    )
    set_session_cookie(response, create_session_token(user.id, user.role, new_version))
    await audit.record(user, "password.changed", "user", user.id)
    school = await get_school()
    return {"user": _me(user.id, {**data, "mustChangePassword": False}, school["name"])}
