#!/usr/bin/env bash
# Replace the server-side Google Maps key (Routes API) without downtime:
# create a new key, store it as the secret's latest version, roll Cloud Run onto
# it, then delete the old key. Use this if the key was ever shown or shared.
set -euo pipefail

PROJECT="${PROJECT:-itransport-einstein}"
REGION="${REGION:-asia-south1}"
SERVICE="${SERVICE:-itransport}"
g() { gcloud --project="$PROJECT" --quiet "$@"; }
quiet() { local out; if ! out="$("$@" 2>&1)"; then printf '%s\n' "$out" >&2; return 1; fi; }

OLD="$(g services api-keys list --filter="displayName=itransport-server" --format="value(name)" 2>/dev/null)"
NEW_NAME="itransport-server-$(date +%Y%m%d%H%M%S)"

echo "▸ Creating a new Routes API key"
quiet g services api-keys create --display-name="$NEW_NAME" --api-target=service=routes.googleapis.com
NEW="$(g services api-keys list --filter="displayName=$NEW_NAME" --format="value(name)")"
g services api-keys get-key-string "$NEW" --format="value(keyString)" | tr -d '\n' |
  g secrets versions add itransport-maps-server-key --data-file=- >/dev/null
quiet g services api-keys update "$NEW" --display-name=itransport-server

echo "▸ Rolling Cloud Run onto the new key"
quiet g run services update "$SERVICE" --region "$REGION" --update-labels "maps-key-rotated=$(date +%s)"

if [[ -n "$OLD" ]]; then
  echo "▸ Deleting the old key"
  for name in $OLD; do quiet g services api-keys delete "$name"; done
fi
echo "✓ Done. The old key no longer works."
