#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# PREFLIGHT GATE — run BEFORE any container restart/rebuild.
#
# Hard precondition: GOOGLE_OAUTH_ENCRYPTION_KEY must be present (and a valid
# 64-hex value) in .env before the API container is ever (re)started — otherwise
# the new container boots without the key, orphaning every credential encrypted
# under it (this happened once and cost the original Google credential).
#
# If the key is missing/invalid, this restores it from the durable backup FIRST.
# If no valid backup exists, it STOPS (non-zero) so the caller must NOT restart.
#
# R2: the key value is never printed — it moves file→file through a pipe only.
#
# Usage (always &&-chain so a failed gate blocks the restart):
#   bash tools/preflight-env-key.sh && docker compose up -d api
#   bash tools/preflight-env-key.sh && docker compose build api && docker compose up -d api
#
# Exit: 0 = key guaranteed present, safe to restart · non-zero = STOP.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ENV_FILE="${1:-.env}"
BKP="${GOOGLE_KEY_BACKUP:-$HOME/.config/business-brain/google_oauth_encryption_key}"
K="GOOGLE_OAUTH_ENCRYPTION_KEY"

present() { grep -qE "^${K}=[0-9a-f]{64}$" "$ENV_FILE"; }

if [ ! -f "$ENV_FILE" ]; then
  echo "preflight: ${ENV_FILE} not found — STOP." >&2
  exit 4
fi

if present; then
  echo "preflight: ${K} present & valid in ${ENV_FILE} ✓ — safe to restart."
  exit 0
fi

echo "preflight: ${K} MISSING/invalid in ${ENV_FILE} — restoring from backup before any restart…" >&2

# Remove any stray/empty/malformed key line so the restore can't create a duplicate.
if grep -qE "^${K}=" "$ENV_FILE"; then
  grep -vE "^${K}=" "$ENV_FILE" > "${ENV_FILE}.pf.tmp" && mv "${ENV_FILE}.pf.tmp" "$ENV_FILE"
fi

if [ -f "$BKP" ] && grep -qE '^[0-9a-f]{64}$' "$BKP"; then
  # value never printed: piped file→file
  { printf '\n%s=' "$K"; tr -d '[:space:]' < "$BKP"; printf '\n'; } >> "$ENV_FILE"
  if present; then
    echo "preflight: restored ${K} from backup ✓ — safe to restart." >&2
    exit 0
  fi
  echo "preflight: restore wrote but failed validation — STOP. Do not restart." >&2
  exit 2
fi

echo "preflight: no valid backup at ${BKP} — STOP. Do NOT restart into a missing key." >&2
echo "preflight: recover the key (password manager / off-machine copy) into ${ENV_FILE} first." >&2
exit 3
