"""Runtime configuration, read once from environment variables."""

from __future__ import annotations

import logging
import os
import secrets
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

log = logging.getLogger("itransport.config")

_DEFAULT_STATIC_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


@dataclass(frozen=True)
class Settings:
    env: str
    project_id: str
    database: str
    session_secret: str
    session_days: int
    cookie_secure: bool
    maps_browser_key: str
    maps_server_key: str
    vapid_public_key: str
    vapid_private_key: str
    vapid_subject: str
    cron_secret: str
    bootstrap_admin_username: str
    bootstrap_admin_password: str
    allowed_origins: tuple[str, ...]
    static_dir: Path
    csp_mode: str
    ai_model: str
    ai_location: str
    ai_project: str
    timezone: str = "Asia/Kolkata"

    @property
    def is_prod(self) -> bool:
        return self.env == "prod"

    @property
    def push_enabled(self) -> bool:
        return bool(self.vapid_public_key and self.vapid_private_key)


@lru_cache
def get_settings() -> Settings:
    env = _env("APP_ENV", "dev")
    session_secret = _env("SESSION_SECRET")
    if not session_secret:
        if env == "prod":
            raise RuntimeError("SESSION_SECRET must be set in production")
        session_secret = secrets.token_urlsafe(48)
        log.warning("SESSION_SECRET not set; using a random dev secret (sessions reset on restart)")

    origins = tuple(o.strip().rstrip("/") for o in _env("ALLOWED_ORIGINS").split(",") if o.strip())
    project_id = _env("GOOGLE_CLOUD_PROJECT", "demo-itransport")

    return Settings(
        env=env,
        project_id=project_id,
        database=_env("FIRESTORE_DATABASE", "(default)"),
        session_secret=session_secret,
        session_days=int(_env("SESSION_DAYS", "30")),
        cookie_secure=_env("COOKIE_SECURE", "true" if env == "prod" else "false") == "true",
        maps_browser_key=_env("MAPS_BROWSER_KEY"),
        maps_server_key=_env("MAPS_SERVER_KEY"),
        vapid_public_key=_env("VAPID_PUBLIC_KEY"),
        vapid_private_key=_env("VAPID_PRIVATE_KEY"),
        vapid_subject=_env("VAPID_SUBJECT", "mailto:transport@example.com"),
        cron_secret=_env("CRON_SECRET"),
        bootstrap_admin_username=_env("BOOTSTRAP_ADMIN_USERNAME", "admin"),
        bootstrap_admin_password=_env("BOOTSTRAP_ADMIN_PASSWORD"),
        allowed_origins=origins,
        static_dir=Path(_env("STATIC_DIR") or _DEFAULT_STATIC_DIR),
        csp_mode=_env("CSP_MODE", "enforce"),
        # Daily AI summaries (Gemini on Vertex AI); off unless a model is set.
        ai_model=_env("AI_MODEL"),
        ai_location=_env("AI_LOCATION", "global"),
        ai_project=_env("AI_PROJECT") or project_id,
    )
