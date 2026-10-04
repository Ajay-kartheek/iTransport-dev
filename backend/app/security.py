"""Password hashing, session tokens and generated secrets."""

from __future__ import annotations

import asyncio
import re
import secrets
import time
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from starlette.concurrency import run_in_threadpool
from starlette.responses import Response

from .config import get_settings

SESSION_COOKIE = "__session"  # the only cookie name Firebase Hosting forwards, if used later
_ALGORITHM = "HS256"
_ISSUER = "itransport"

# argon2id at the OWASP baseline (19 MiB, 2 passes). Existing hashes made with other
# settings are upgraded on the next successful sign-in (see needs_rehash).
_hasher = PasswordHasher(time_cost=2, memory_cost=19_456, parallelism=1)
# Verified against when the username does not exist, so both paths cost the same.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))
# Each hash needs ~19 MiB; cap concurrent hashing so a burst of sign-ins can't
# exhaust the instance's memory. Extra requests wait their turn.
_hash_gate = asyncio.Semaphore(2)

USERNAME_PATTERN = r"^[a-z0-9][a-z0-9._-]{2,31}$"
_USERNAME_RE = re.compile(USERNAME_PATTERN)

MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 128

_WORDS = (
    "amber",
    "anchor",
    "apple",
    "arrow",
    "aspen",
    "badge",
    "bamboo",
    "banyan",
    "beacon",
    "berry",
    "bison",
    "blossom",
    "breeze",
    "brook",
    "cactus",
    "candle",
    "canyon",
    "cedar",
    "cherry",
    "cliff",
    "cloud",
    "clover",
    "comet",
    "coral",
    "cotton",
    "crane",
    "creek",
    "daisy",
    "delta",
    "dune",
    "eagle",
    "ember",
    "falcon",
    "fern",
    "field",
    "flint",
    "forest",
    "garden",
    "glacier",
    "grove",
    "harbor",
    "hazel",
    "heron",
    "hill",
    "honey",
    "island",
    "ivory",
    "jasmine",
    "kite",
    "lagoon",
    "lake",
    "lantern",
    "lemon",
    "lily",
    "lotus",
    "maple",
    "meadow",
    "mango",
    "marble",
    "mint",
    "monsoon",
    "moon",
    "nectar",
    "ocean",
    "olive",
    "orchid",
    "otter",
    "palm",
    "panda",
    "pearl",
    "pebble",
    "pepper",
    "pine",
    "planet",
    "pond",
    "poppy",
    "prism",
    "quartz",
    "rain",
    "raven",
    "reef",
    "ridge",
    "river",
    "robin",
    "rocket",
    "saffron",
    "sage",
    "shell",
    "silver",
    "sky",
    "sparrow",
    "spring",
    "star",
    "stone",
    "summit",
    "sunny",
    "tiger",
    "tulip",
    "valley",
    "willow",
)


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(stored_hash or _DUMMY_HASH, password) and stored_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


async def hash_password_async(password: str) -> str:
    async with _hash_gate:
        return await run_in_threadpool(hash_password, password)


async def verify_password_async(stored_hash: str | None, password: str) -> bool:
    async with _hash_gate:
        return await run_in_threadpool(verify_password, stored_hash, password)


def valid_username(username: str) -> bool:
    """Lower-case letters, digits, dots, dashes and underscores; starts with a letter or digit."""
    return bool(_USERNAME_RE.fullmatch(username))


def needs_rehash(stored_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(stored_hash)
    except InvalidHashError:
        return True


def password_problem(password: str, username: str) -> str | None:
    """Return a human-readable problem with a new password, or None if it is fine."""
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Use at least {MIN_PASSWORD_LENGTH} characters."
    if len(password) > MAX_PASSWORD_LENGTH:
        return f"Use at most {MAX_PASSWORD_LENGTH} characters."
    if password.strip().lower() == username.strip().lower():
        return "Your password can't be the same as your username."
    if len(set(password)) < 4:
        return "Pick a password that is harder to guess."
    return None


def generate_temp_password() -> str:
    """Readable over the phone, e.g. ``Maple-4821-river``; users must change it at first login."""
    first = secrets.choice(_WORDS).capitalize()
    second = secrets.choice(_WORDS)
    return f"{first}-{secrets.randbelow(9000) + 1000}-{second}"


def generate_tracker_key() -> str:
    return secrets.token_urlsafe(18)


def create_session_token(user_id: str, role: str, token_version: int) -> str:
    s = get_settings()
    now = int(time.time())
    payload = {
        "sub": user_id,
        "role": role,
        "ver": token_version,
        "iat": now,
        "exp": now + s.session_days * 86_400,
        "iss": _ISSUER,
    }
    return jwt.encode(payload, s.session_secret, algorithm=_ALGORITHM)


def set_session_cookie(response: Response, token: str) -> None:
    s = get_settings()
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=s.session_days * 86_400,
        httponly=True,
        secure=s.cookie_secure,
        samesite="lax",
        path="/",
    )


def decode_session_token(token: str) -> dict[str, Any] | None:
    s = get_settings()
    try:
        return jwt.decode(
            token,
            s.session_secret,
            algorithms=[_ALGORITHM],
            issuer=_ISSUER,
            options={"require": ["sub", "exp", "iat", "ver"]},
        )
    except jwt.PyJWTError:
        return None
