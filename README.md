# iTransport

Live school-bus tracking for one school (built to grow to more):

- **Parents** see their child's bus moving on a map, get an honest arrival time for their stop,
  receive alerts (trip started, bus ~10 min away, reached their child's campus, plan reminders)
  and mark each trip **Riding** or **Absent**.
- **Drivers** pick their bus, see who is riding at each stop, **slide to start** the trip — the phone
  then shares its location — and **slide to end** it.
- **The transport office** manages campuses, buses, routes and stops, students, parent/driver
  logins and school settings, watches every bus live, and reads each day's activity with a short
  AI-written summary.

## How it works

```
 Driver phone (browser) ──GPS fixes──▶ ┌────────────────────────────────────┐
 Traccar Client (fallback) ──────────▶ │ Cloud Run: FastAPI + React web app │──▶ Routes API (ETAs)
 Parents / office (browser) ◀─polls──▶ │  · filters fixes, detects stops    │──▶ Web Push (alerts)
                                       │  · ETAs, alerts, auth, admin API   │
 Cloud Scheduler (15 min) ──tick─────▶ └──────────────┬─────────────────────┘──▶ Vertex AI (day summary)
                                                      ▼
                                          Firestore (asia-south1)
```

| Part | Tech |
|---|---|
| Backend | Python 3.12, FastAPI, Firestore (async client), argon2 passwords, JWT session cookie |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, Motion, TanStack Query |
| Maps | Maps JavaScript API (map), Places API (stop search), Routes API (traffic-aware ETAs) |
| Hosting | One Cloud Run service (serves the web app and `/api`), Secret Manager, Cloud Scheduler |
| AI | Daily summary by Gemini (`gemini-3.1-flash-lite`) on Vertex AI — one short call per day |

**Getting the location right** (`backend/app/geo.py`): fixes less accurate than 100 m, out of
order, from the future, or implying impossible speeds are dropped; stops are reached inside a
configurable radius (stops the bus drives past are marked "passed"); no fix for 2 minutes shows
"Location unavailable since …" instead of a guess; ETAs come from the Routes API every ≤45 s (a
clearly labelled estimate is used if Maps is unavailable). Location is only shared between *Start
trip* and *End trip*, and history auto-deletes after 30 days.

## Run it locally

Prerequisites: Python 3.12 + [uv](https://docs.astral.sh/uv/), Node 22+, the Google Cloud CLI with
the Firestore emulator (`gcloud components install cloud-firestore-emulator`, needs Java 21+).

```bash
# 1. Database (local emulator)
gcloud emulators firestore start --host-port=127.0.0.1:8085

# 2. API on :8077 (separate terminal)
cd backend
uv sync
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 GOOGLE_CLOUD_PROJECT=demo-itransport
uv run python -m scripts.seed_demo --password demo-pass-2026 --every-day   # demo school
uv run uvicorn app.main:app --port 8077 --reload

# 3. Web app on :5180 (separate terminal)
cd frontend
npm install
npm run dev
```

Open http://127.0.0.1:5180 and sign in as `admin`, `ravi` (driver) or `priya` (parent) — all with
`demo-pass-2026`. To watch a bus move, start a trip as `ravi` and run the simulator:

```bash
cd backend
uv run python -m scripts.simulate_trip --driver ravi --password demo-pass-2026 --direction AM --base http://127.0.0.1:8077
```

Without a Maps key the app still works: maps show a placeholder, ETAs are labelled estimates, and
stops can be added by pasting coordinates (e.g. `13.0850, 80.2101`).

Day summaries are off locally unless you point the API at Vertex AI (after
`gcloud auth application-default login`): add
`AI_MODEL=gemini-3.1-flash-lite AI_PROJECT=itransport-einstein` to the API's environment.

## Tests

```bash
cd backend && uv run pytest -q          # unit tests + full API flow against the emulator
cd frontend && npx tsc --noEmit         # type check
```

## Deploy to Google Cloud

The project must have billing enabled. Then:

```bash
gcloud auth login            # once
./deploy/deploy.sh           # PROJECT=itransport-einstein REGION=asia-south1 by default
```

The script enables the APIs, creates the Firestore database (asia-south1), a least-privilege
service account (Firestore + Vertex AI user), secrets (session key, cron key, VAPID keys, first
admin password), two restricted Maps keys (browser: referrer-locked to the app; server: Routes API
only), deploys to Cloud Run and schedules the 15-minute tick. The first run prints the URL and the
first admin's temporary password. Re-run it to deploy updates; `AI_MODEL= ./deploy/deploy.sh`
deploys with day summaries turned off.

## Day-to-day

- **First sign-in** — every new account (created under *People & logins*) gets a readable temporary
  password, e.g. `Maple-4821-river`, and must choose its own at first sign-in.
- **Phones that can't keep the browser open** — install the free *Traccar Client* app, set the
  server URL to `https://<your-app>/api/ingest/osmand`, the device identifier to the bus's
  tracker key (shown when editing the bus) and the frequency to 15 seconds. Positions are only used
  while that bus has a trip running.
- **Alerts on iPhone** — parents add iTransport to the Home Screen (Share → Add to Home Screen),
  open it from there, and tap *Turn on alerts*.
- **Campuses** — add up to four under *School settings*. Each route lists the campuses its bus
  goes to in morning order (afternoon trips run in reverse), and each student is linked to one of
  their route's campuses, so parents see "Reached Junior Campus at 7:55 AM" for their own child.
- **Activity and day summary** — *Activity* shows one day at a time (pick any date). The day's
  summary is written automatically at 8 PM, or on demand with *Summarize today so far*. The model
  only sees counts, times, bus and route numbers — never student or parent names.
- **Cutoffs, alert timing, school days, holidays** — *School settings*.

## Configuration (environment variables)

| Variable | Purpose |
|---|---|
| `APP_ENV` | `prod` enables secure cookies, HSTS and hides the API docs |
| `GOOGLE_CLOUD_PROJECT`, `FIRESTORE_DATABASE` | Firestore project / database |
| `SESSION_SECRET` | signs session cookies (required in prod) |
| `MAPS_BROWSER_KEY`, `MAPS_SERVER_KEY` | Maps JavaScript/Places key and Routes API key |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | web push |
| `CRON_SECRET` | shared key for `/api/cron/tick` |
| `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD` | first admin, created only when no admin exists |
| `CSP_MODE` | `enforce` (default) or `report` |
| `AI_MODEL`, `AI_LOCATION`, `AI_PROJECT` | Gemini model for day summaries (empty = off), Vertex AI location (`global`) and project (defaults to `GOOGLE_CLOUD_PROJECT`) |
