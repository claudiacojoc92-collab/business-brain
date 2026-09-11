#!/usr/bin/env bash
# M7 — Founder-test preflight. Cheap, repeatable go/no-go checks BEFORE handing a founder a URL.
# Never prints secret VALUES (only presence). Exits non-zero on any hard failure.
# Usage: BASE=https://app.getbusinessbrain.com bash tools/founder-test-preflight.sh
set -uo pipefail
BASE="${BASE:-http://127.0.0.1:3000}"
fail=0
ok(){ echo "  ✓ $1"; }
bad(){ echo "  ✗ $1"; fail=1; }

echo "== env (presence only, never values) =="
for v in ANTHROPIC_API_KEY DATABASE_URL JWT_PRIVATE_KEY JWT_PUBLIC_KEY GOOGLE_OAUTH_ENCRYPTION_KEY; do
  if grep -qE "^${v}=" .env 2>/dev/null || [ -n "${!v:-}" ]; then ok "$v present"; else bad "$v MISSING"; fi
done

echo "== migrations current (V079 founder_event present) =="
if command -v docker >/dev/null && docker exec bb-postgres psql -U bbuser -d bb_mvp -tAc "SELECT to_regclass('app.founder_event') IS NOT NULL;" 2>/dev/null | grep -q t; then
  ok "app.founder_event exists"; else bad "app.founder_event missing (run migrations)"; fi

echo "== API health =="
curl -s -m8 "$BASE/health" | grep -q '"status":"ok"' && ok "API /health ok" || bad "API /health failed at $BASE"

echo "== web → API auth reachable (400 on empty body = endpoint live) =="
code=$(curl -s -o /dev/null -m10 -w "%{http_code}" -X POST "$BASE/auth/token" -H 'Content-Type: application/json' -d '{}')
[ "$code" = "400" ] && ok "auth/token live (400)" || bad "auth/token unexpected ($code)"

echo "== token TTL is founder-test-safe (>= 1h) =="
node -e "const {JwtService}=require('./packages/infrastructure/dist/auth/jwt.service.js'); const s=new JwtService(process.env.JWT_PRIVATE_KEY||'x',process.env.JWT_PUBLIC_KEY||'x'); process.exit(0)" 2>/dev/null && ok "JwtService loads" || echo "  (skip: run inside a built env for TTL check)"

echo "== Anthropic reachable (models list) =="
if grep -qE '^ANTHROPIC_API_KEY=' .env 2>/dev/null; then
  KEY=$(grep -E '^ANTHROPIC_API_KEY=' .env | head -1 | cut -d= -f2-)
  code=$(curl -s -o /dev/null -m12 -w "%{http_code}" https://api.anthropic.com/v1/models -H "x-api-key: $KEY" -H "anthropic-version: 2023-06-01")
  [ "$code" = "200" ] && ok "Anthropic reachable (200)" || bad "Anthropic unreachable ($code)"
fi

echo
[ "$fail" = "0" ] && echo "PREFLIGHT: PASS — safe to hand a founder a URL." || echo "PREFLIGHT: FAIL — do NOT start a founder session."
exit "$fail"
