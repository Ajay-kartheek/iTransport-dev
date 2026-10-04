# iTransport: one container serving the React app and the FastAPI API on Cloud Run.

# ---- web app ----
FROM node:24-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- api ----
FROM python:3.12-slim AS app
COPY --from=ghcr.io/astral-sh/uv:0.11.13 /uv /uvx /bin/
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/srv/venv

WORKDIR /srv/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/ ./
COPY --from=web /web/dist /srv/web

ENV PATH="/srv/venv/bin:$PATH" \
    STATIC_DIR=/srv/web \
    APP_ENV=prod

RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app
USER app

EXPOSE 8080
# No --proxy-headers: the app reads X-Forwarded-For itself (right-most entry only).
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --no-server-header"]
