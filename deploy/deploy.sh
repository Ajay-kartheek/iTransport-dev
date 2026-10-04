#!/usr/bin/env bash
# Deploy iTransport to Google Cloud: Cloud Run (web app + API), Firestore,
# Secret Manager, Google Maps Platform keys and a Cloud Scheduler tick.
#
#   ./deploy/deploy.sh
#
# Safe to re-run: each step checks what already exists. Override defaults with
# PROJECT=..., REGION=..., SERVICE=... environment variables. Daily summaries use
# a low-cost Gemini model on Vertex AI; AI_MODEL= (empty) turns them off.
set -euo pipefail

PROJECT="${PROJECT:-itransport-einstein}"
REGION="${REGION:-asia-south1}"
SERVICE="${SERVICE:-itransport}"
AI_MODEL="${AI_MODEL-gemini-3.1-flash-lite}"
AI_LOCATION="${AI_LOCATION:-global}"
SA_NAME="itransport-run"
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

g() { gcloud --project="$PROJECT" --quiet "$@"; }
step() { printf '\n\033[1;34m▸ %s\033[0m\n' "$*"; }
rand() { python3 -c "import secrets, sys; sys.stdout.write(secrets.token_urlsafe($1))"; }
backend_py() { (cd "$ROOT/backend" && uv run --quiet python "$@"); }

secret_exists() { g secrets describe "$1" >/dev/null 2>&1; }
create_secret() { printf '%s' "$2" | g secrets create "$1" --data-file=- --replication-policy=automatic >/dev/null; }
read_secret() { g secrets versions access latest --secret="$1"; }
grant_secret() {
  g secrets add-iam-policy-binding "$1" --member="serviceAccount:$SA" \
    --role=roles/secretmanager.secretAccessor >/dev/null
}
api_key_name() {
  g services api-keys list --filter="displayName=$1" --format="value(name)" 2>/dev/null | head -n1
}
api_key_string() { g services api-keys get-key-string "$1" --format="value(keyString)"; }
# gcloud echoes new API keys (including the secret key string); only show output on failure.
quiet() {
  local out
  if ! out="$("$@" 2>&1)"; then
    printf '%s\n' "$out" >&2
    return 1
  fi
}

step "Checking billing on $PROJECT"
if [[ "$(gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)')" != "True" ]]; then
  echo "Billing isn't enabled. Link an open billing account first:"
  echo "  https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT"
  exit 1
fi
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
URL_GUESS="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"

step "Enabling APIs (the first run takes a minute or two)"
g services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  compute.googleapis.com firestore.googleapis.com secretmanager.googleapis.com \
  cloudscheduler.googleapis.com apikeys.googleapis.com aiplatform.googleapis.com \
  maps-backend.googleapis.com routes.googleapis.com places.googleapis.com

step "Firestore database in $REGION"
if ! g firestore databases describe --database="(default)" >/dev/null 2>&1; then
  quiet g firestore databases create --database="(default)" --location="$REGION" --type=firestore-native
fi
# Location history (30 days) and audit entries (400 days) delete themselves.
for group in points audit; do
  g firestore fields ttls update expireAt --collection-group="$group" --enable-ttl --async \
    >/dev/null 2>&1 || true
done

step "Service accounts"
if ! g iam service-accounts describe "$SA" >/dev/null 2>&1; then
  g iam service-accounts create "$SA_NAME" --display-name="iTransport (Cloud Run)"
  sleep 10 # let the new account propagate before granting roles
fi
for role in roles/datastore.user roles/aiplatform.user; do
  g projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" \
    --role="$role" --condition=None >/dev/null
done
# Source deploys build with the Compute Engine default service account.
g projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role=roles/run.builder --condition=None >/dev/null

step "Secrets"
secret_exists itransport-session-secret || create_secret itransport-session-secret "$(rand 48)"
secret_exists itransport-cron-secret || create_secret itransport-cron-secret "$(rand 32)"
NEW_ADMIN_PASSWORD=""
if ! secret_exists itransport-admin-password; then
  NEW_ADMIN_PASSWORD=1
  create_secret itransport-admin-password \
    "$(backend_py -c 'from app.security import generate_temp_password as g; print(g(), end="")')"
fi
if ! secret_exists itransport-vapid-private; then
  VAPID_JSON="$(backend_py -m scripts.gen_vapid)"
  create_secret itransport-vapid-private "$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["privateKey"], end="")' "$VAPID_JSON")"
  create_secret itransport-vapid-public "$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["publicKey"], end="")' "$VAPID_JSON")"
fi
VAPID_PUBLIC="$(read_secret itransport-vapid-public)"

step "Google Maps Platform keys"
SERVER_KEY_NAME="$(api_key_name itransport-server)"
if [[ -z "$SERVER_KEY_NAME" ]]; then
  quiet g services api-keys create --display-name=itransport-server \
    --api-target=service=routes.googleapis.com
  SERVER_KEY_NAME="$(api_key_name itransport-server)"
fi
secret_exists itransport-maps-server-key || \
  create_secret itransport-maps-server-key "$(api_key_string "$SERVER_KEY_NAME")"

BROWSER_KEY_NAME="$(api_key_name itransport-browser)"
if [[ -z "$BROWSER_KEY_NAME" ]]; then
  quiet g services api-keys create --display-name=itransport-browser \
    --allowed-referrers="${URL_GUESS}/*,http://localhost:5180/*,http://127.0.0.1:5180/*" \
    --api-target=service=maps-backend.googleapis.com \
    --api-target=service=places.googleapis.com
  BROWSER_KEY_NAME="$(api_key_name itransport-browser)"
fi
BROWSER_KEY="$(api_key_string "$BROWSER_KEY_NAME")"

for name in itransport-session-secret itransport-cron-secret itransport-admin-password \
  itransport-vapid-private itransport-maps-server-key; do
  grant_secret "$name"
done

step "Building and deploying to Cloud Run (about 5 minutes the first time)"
g run deploy "$SERVICE" \
  --source "$ROOT" \
  --region "$REGION" \
  --service-account "$SA" \
  --allow-unauthenticated \
  --memory 512Mi --cpu 1 \
  --min-instances 0 --max-instances 4 --concurrency 80 --timeout 60 \
  --set-env-vars "APP_ENV=prod,GOOGLE_CLOUD_PROJECT=${PROJECT},MAPS_BROWSER_KEY=${BROWSER_KEY},VAPID_PUBLIC_KEY=${VAPID_PUBLIC},VAPID_SUBJECT=${URL_GUESS},BOOTSTRAP_ADMIN_USERNAME=admin,AI_MODEL=${AI_MODEL},AI_LOCATION=${AI_LOCATION}" \
  --set-secrets "SESSION_SECRET=itransport-session-secret:latest,CRON_SECRET=itransport-cron-secret:latest,BOOTSTRAP_ADMIN_PASSWORD=itransport-admin-password:latest,VAPID_PRIVATE_KEY=itransport-vapid-private:latest,MAPS_SERVER_KEY=itransport-maps-server-key:latest"

URL="$(g run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
if [[ "$URL" != "$URL_GUESS" ]]; then
  step "Allowing $URL for the browser Maps key"
  quiet g services api-keys update "$BROWSER_KEY_NAME" \
    --allowed-referrers="${URL_GUESS}/*,${URL}/*,http://localhost:5180/*,http://127.0.0.1:5180/*"
fi

step "Reminder and clean-up schedule (every 15 minutes)"
g scheduler jobs delete itransport-tick --location "$REGION" >/dev/null 2>&1 || true
g scheduler jobs create http itransport-tick \
  --location "$REGION" \
  --schedule "*/15 * * * *" \
  --time-zone "Asia/Kolkata" \
  --uri "${URL}/api/cron/tick" \
  --http-method POST \
  --headers "X-Cron-Key=$(read_secret itransport-cron-secret),Content-Type=application/json" \
  --message-body '{}' \
  --attempt-deadline 60s >/dev/null

printf '\n\033[1;32m✓ iTransport is live:\033[0m %s\n' "$URL"
if [[ -n "$NEW_ADMIN_PASSWORD" ]]; then
  # Only on the first deploy; the password is replaced at first sign-in.
  printf '  First sign-in: username \033[1madmin\033[0m, temporary password \033[1m%s\033[0m\n' \
    "$(read_secret itransport-admin-password)"
  printf '  You will be asked to choose your own password straight away.\n'
fi
