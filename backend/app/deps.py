"""Request dependencies: who is signed in, and what they may do."""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from fastapi import Depends, Request, Response

from .db import USERS, get_db
from .errors import ApiError
from .security import (
    SESSION_COOKIE,
    create_session_token,
    decode_session_token,
    set_session_cookie,
)

SESSION_RENEW_AFTER_S = 86_400

ROLES = ("ADMIN", "DRIVER", "PARENT")


@dataclass(frozen=True)
class CurrentUser:
    id: str
    username: str
    name: str
    role: str
    must_change_password: bool
    bus_ids: tuple[str, ...]
    token_version: int


async def load_session_user(request: Request) -> tuple[CurrentUser, dict[str, Any]] | None:
    """Resolve the session cookie to a fresh user record (and the token's claims).

    The user document is re-read on every request so that disabling an account,
    changing a role or resetting a password takes effect immediately.
    """
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    claims = decode_session_token(token)
    if not claims:
        return None
    snap = await get_db().collection(USERS).document(str(claims["sub"])).get()
    if not snap.exists:
        return None
    data = snap.to_dict() or {}
    if not data.get("active", True):
        return None
    if int(data.get("tokenVersion", 0)) != int(claims.get("ver", -1)):
        return None
    user = CurrentUser(
        id=snap.id,
        username=data.get("username", ""),
        name=data.get("name", ""),
        role=data.get("role", ""),
        must_change_password=bool(data.get("mustChangePassword")),
        bus_ids=tuple(data.get("busIds") or ()),
        token_version=int(data.get("tokenVersion", 0)),
    )
    return user, claims


async def signed_in_user(request: Request, response: Response) -> CurrentUser:
    """Any signed-in user, including one who still has to change a temporary password.

    Sessions roll forward: once a day of use, the cookie is re-issued so people who
    use the app regularly (like drivers mid-trip) are never signed out by expiry.
    """
    session = await load_session_user(request)
    if session is None:
        raise ApiError(401, "unauthenticated", "Please sign in to continue.")
    user, claims = session
    if time.time() - int(claims.get("iat", 0)) > SESSION_RENEW_AFTER_S:
        set_session_cookie(response, create_session_token(user.id, user.role, user.token_version))
    return user


async def current_user(user: CurrentUser = Depends(signed_in_user)) -> CurrentUser:
    if user.must_change_password:
        raise ApiError(403, "password_change_required", "Please set a new password to continue.")
    return user


def require_role(*roles: str) -> Callable[..., Awaitable[CurrentUser]]:
    async def dependency(user: CurrentUser = Depends(current_user)) -> CurrentUser:
        if user.role not in roles:
            raise ApiError(403, "forbidden", "You don't have access to this page.")
        return user

    return dependency


require_admin = require_role("ADMIN")
require_driver = require_role("DRIVER")
require_parent = require_role("PARENT")
