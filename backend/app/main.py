"""FastAPI application: API routers, security middleware and the web app."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from google.cloud.firestore import FieldFilter
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.gzip import GZipMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import Settings, get_settings
from .db import USERS, get_db
from .errors import ApiError
from .routers import admin, auth, driver, ingest, parent, system
from .services.users import create_user

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("itransport")

# Google's documented allowlist policy for the Maps JavaScript API, plus our own origin.
CSP = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self' 'unsafe-eval' blob: https://*.googleapis.com https://*.gstatic.com "
        "*.google.com https://*.ggpht.com *.googleusercontent.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com *.google.com "
        "*.googleusercontent.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "connect-src 'self' data: blob: https://*.googleapis.com *.google.com https://*.gstatic.com",
        "frame-src *.google.com",
        "worker-src 'self' blob:",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
)

_UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
_ORIGIN_EXEMPT = ("/api/ingest/", "/api/cron/")


class SecurityMiddleware:
    """Adds security headers and rejects cross-site state-changing API calls."""

    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.settings = settings
        self.csp_header = (
            "Content-Security-Policy-Report-Only"
            if settings.csp_mode == "report"
            else "Content-Security-Policy"
        )

    def _origin_ok(self, scope: Scope) -> bool:
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        origin = headers.get("origin")
        if not origin or origin == "null":
            # Browsers always send Origin on cross-site POSTs; a missing one is same-site
            # or a non-browser client, which can't carry the SameSite=Lax cookie anyway.
            return origin is None
        if origin.rstrip("/") in self.settings.allowed_origins:
            return True
        host = headers.get("x-forwarded-host") or headers.get("host", "")
        return urlsplit(origin).netloc == host

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path: str = scope.get("path", "")
        if (
            scope.get("method") in _UNSAFE_METHODS
            and path.startswith("/api/")
            and not path.startswith(_ORIGIN_EXEMPT)
            and not self._origin_ok(scope)
        ):
            response = JSONResponse(
                {"error": {"code": "bad_origin", "message": "Request blocked (cross-site)."}},
                status_code=403,
            )
            await response(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.setdefault("X-Content-Type-Options", "nosniff")
                headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
                headers.setdefault("X-Frame-Options", "DENY")
                headers.setdefault(
                    "Permissions-Policy", "geolocation=(self), camera=(), microphone=()"
                )
                headers.setdefault(self.csp_header, CSP)
                if self.settings.is_prod:
                    headers.setdefault(
                        "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
                    )
                if path.startswith("/api/"):
                    headers.setdefault("Cache-Control", "no-store")
                elif path.startswith("/assets/"):
                    # Hashed file names never change content, but a 404 (e.g. an old
                    # chunk requested right after a deploy) must not be cached.
                    ok = message["status"] < 400
                    headers["Cache-Control"] = (
                        "public, max-age=31536000, immutable" if ok else "no-store"
                    )
            await send(message)

        await self.app(scope, receive, send_with_headers)


async def bootstrap_admin(settings: Settings) -> None:
    """Create the first admin from env vars when the database has no admin yet."""
    if not settings.bootstrap_admin_password:
        return
    query = get_db().collection(USERS).where(filter=FieldFilter("role", "==", "ADMIN")).limit(1)
    if [s async for s in query.stream()]:
        return
    await create_user(
        name="Transport Admin",
        username=settings.bootstrap_admin_username,
        role="ADMIN",
        password=settings.bootstrap_admin_password,
    )
    log.info("Created bootstrap admin '%s'", settings.bootstrap_admin_username)


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


def _friendly_validation(exc: RequestValidationError) -> str:
    for err in exc.errors():
        field = ".".join(str(p) for p in err.get("loc", ())[1:]) or "request"
        return f"Please check {field}: {err.get('msg', 'invalid value')}."
    return "Some details are missing or invalid."


def create_app() -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.http = httpx.AsyncClient(timeout=10.0)
        try:
            await bootstrap_admin(settings)
        except Exception:
            log.exception("Bootstrap admin failed")
        yield
        await app.state.http.aclose()

    app = FastAPI(
        title="iTransport API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=None if settings.is_prod else "/api/docs",
        redoc_url=None,
        openapi_url=None if settings.is_prod else "/api/openapi.json",
    )
    app.add_middleware(GZipMiddleware, minimum_size=1000)
    app.add_middleware(SecurityMiddleware, settings=settings)

    @app.exception_handler(ApiError)
    async def api_error(_: Request, exc: ApiError) -> JSONResponse:
        return _error(exc.status, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return _error(422, "invalid", _friendly_validation(exc))

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        messages = {404: "Not found.", 405: "Method not allowed."}
        return _error(exc.status_code, "http_error", messages.get(exc.status_code, str(exc.detail)))

    @app.exception_handler(Exception)
    async def crash(_: Request, exc: Exception) -> JSONResponse:
        log.exception("Unhandled error", exc_info=exc)
        return _error(500, "internal", "Something went wrong on our side. Please try again.")

    for module in (auth, parent, driver, admin, system, ingest):
        app.include_router(module.router)

    _mount_web_app(app, settings.static_dir)
    return app


def _mount_web_app(app: FastAPI, dist: Path) -> None:
    index = dist / "index.html"
    if not index.is_file():
        log.info("No built web app at %s; serving the API only", dist)
        return
    root = dist.resolve()
    if (dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    async def web_app(full_path: str) -> FileResponse:
        if full_path.startswith("api/") or full_path == "api":
            raise ApiError(404, "not_found", "Not found.")
        if full_path:
            candidate = (dist / full_path).resolve()
            if candidate.is_file() and root in candidate.parents:
                cache = (
                    "no-cache"
                    if candidate.name in ("sw.js", "manifest.webmanifest")
                    else ("public, max-age=86400")
                )
                return FileResponse(candidate, headers={"Cache-Control": cache})
        return FileResponse(index, headers={"Cache-Control": "no-cache"})


app = create_app()
