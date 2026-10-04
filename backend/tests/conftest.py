"""Test setup: point the app at the local Firestore emulator and wipe it per test."""

from __future__ import annotations

import os

os.environ.setdefault("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8085")
os.environ["GOOGLE_CLOUD_PROJECT"] = "demo-itransport-test"
os.environ["APP_ENV"] = "test"
os.environ["SESSION_SECRET"] = "test-session-secret-0123456789abcdef"
os.environ["CRON_SECRET"] = "test-cron-secret"
os.environ["COOKIE_SECURE"] = "false"
for key in (
    "MAPS_SERVER_KEY",
    "MAPS_BROWSER_KEY",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "AI_MODEL",
):
    os.environ.pop(key, None)

from collections.abc import AsyncIterator  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402

from app import cache  # noqa: E402
from app.main import app  # noqa: E402

EMULATOR = f"http://{os.environ['FIRESTORE_EMULATOR_HOST']}"
PROJECT = os.environ["GOOGLE_CLOUD_PROJECT"]


def emulator_running() -> bool:
    try:
        return httpx.get(EMULATOR, timeout=1).status_code < 500
    except httpx.HTTPError:
        return False


@pytest.fixture
async def clean_db() -> AsyncIterator[None]:
    if not emulator_running():
        pytest.skip("Firestore emulator is not running on " + EMULATOR)
    async with httpx.AsyncClient() as http:
        await http.delete(
            f"{EMULATOR}/emulator/v1/projects/{PROJECT}/databases/(default)/documents"
        )
    cache.invalidate()
    _reset_rate_limits()
    yield
    cache.invalidate()


def _reset_rate_limits() -> None:
    """Every test signs in from the same test client address; start each with clean limits."""
    from app.routers import auth, ingest

    for limiter in (auth._ip_limiter, auth._password_change_limiter, ingest._limiter):
        limiter._hits.clear()


@pytest.fixture
async def api(clean_db: None) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient() as outbound:
        app.state.http = outbound
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            yield client


def make_client() -> httpx.AsyncClient:
    """A separate browser (its own cookie jar) talking to the same app."""
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
