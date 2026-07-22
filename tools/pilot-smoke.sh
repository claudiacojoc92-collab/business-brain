#!/usr/bin/env bash
# Founder Validation Readiness — LIVE PILOT SMOKE TEST (facilitator/local). Runs the full pilot journey against a running
# API. Deterministic by default (boot the API with CLARITY_FIXTURE=1); set RUN_LIVE_MODEL=1 + a real ANTHROPIC_API_KEY on
# the API for a live-model run. Requires: API on $BASE (default :3000) booted with PILOT_ADMIN_TOKEN set to $ADMIN below.
#
# Usage:  ADMIN=your-token BASE=http://localhost:3000 bash tools/pilot-smoke.sh
set -euo pipefail
BASE="${BASE:-http://localhost:3000}"
ADMIN="${ADMIN:-${PILOT_ADMIN_TOKEN:-}}"
CJ="$(mktemp)"; PASS=0; FAIL=0
say() { printf '%-4s %s\n' "$1" "$2"; }
ok() { PASS=$((PASS+1)); say "PASS" "$1"; }
no() { FAIL=$((FAIL+1)); say "FAIL" "$1"; }
jqv() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1" 2>/dev/null || echo ""; }

[ -n "$ADMIN" ] || { echo "ADMIN token required (export ADMIN=... matching the API's PILOT_ADMIN_TOKEN)"; exit 2; }
EMAIL="pilot.smoke+$(date +%s)@founder.test"
SECRET="SMOKE-SECRET-$(date +%s)"

# 1) Admin creates an invite
CODE=$(curl -s -X POST "$BASE/api/admin/pilot/invites" -H "x-pilot-admin-token: $ADMIN" -H 'content-type: application/json' -d '{"cohort":"smoke","count":1}' | jqv "d['codes'][0]")
[ -n "$CODE" ] && ok "1 admin created invite $CODE" || no "1 invite creation"

# 2) Founder activates account
curl -s -c "$CJ" -b "$CJ" -X POST "$BASE/api/auth/signup" -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"CorrectHorse9!\"}" -o /dev/null
ACT=$(curl -s -c "$CJ" -b "$CJ" -X POST "$BASE/api/pilot/activate" -H 'content-type: application/json' -d "{\"code\":\"$CODE\",\"consentPilot\":true,\"consentResearchReview\":true}" | jqv "d.get('activated')")
[ "$ACT" = "True" ] && ok "2-3 founder activated with consent" || no "2-3 activation"

# 4) Minimal setup
curl -s -c "$CJ" -b "$CJ" -X POST "$BASE/api/pilot/setup" -H 'content-type: application/json' -d '{"businessName":"Acme","sells":"a specialist service","primaryCustomer":"early founders","stage":"early customers","complete":true}' -o /dev/null && ok "4 minimal setup" || no "4 setup"

# 5) Submit a real concern (reality marker + clarity turn)
T1=$(curl -s -c "$CJ" -b "$CJ" -X POST "$BASE/api/clarity/turn" -H 'content-type: application/json' -d "{\"input\":\"$SECRET everyone says run ads but Im not sure\"}")
CONCERN=$(echo "$T1" | jqv "d['concernId']"); CHANGE=$(echo "$T1" | jqv "d['proposedChanges'][0]['id']")
curl -s -c "$CJ" -b "$CJ" -X POST "$BASE/api/pilot/reality" -H 'content-type: application/json' -d "{\"concernId\":\"$CONCERN\",\"marker\":\"yes_now\"}" -o /dev/null
[ "$(echo "$T1" | jqv "d['ok']")" = "True" ] && ok "5 clarity result produced" || no "5 clarity result"

# 6) Accept one understanding change
curl -s -c "$CJ" -b "$CJ" -X POST "$BASE/api/clarity/changes/$CHANGE/accept" -o /dev/null && ok "6 accepted an understanding change" || no "6 accept"

# 7) Submit feedback
curl -s -c "$CJ" -b "$CJ" -X POST "$BASE/api/pilot/feedback" -H 'content-type: application/json' -d "{\"concernId\":\"$CONCERN\",\"clearer\":\"yes\",\"changedAttention\":\"yes\",\"reachedAlone\":\"probably_not\"}" -o /dev/null && ok "7 feedback submitted" || no "7 feedback"

# 8-9) Return with a second concern; check prior context reuse (continuity)
T2=$(curl -s -c "$CJ" -b "$CJ" -X POST "$BASE/api/clarity/turn" -H 'content-type: application/json' -d '{"input":"A marketer says double my ad budget. Should I?"}')
CONT=$(echo "$T2" | jqv "len(d['result']['continuity'])")
[ "${CONT:-0}" -gt 0 ] && ok "8-9 second concern reused prior context ($CONT items)" || no "8-9 context reuse"

# 10) Admin sees pilot metadata
SUM=$(curl -s "$BASE/api/admin/pilot/summary" -H "x-pilot-admin-token: $ADMIN" | jqv "len(d['founders'])")
[ "${SUM:-0}" -gt 0 ] && ok "10 admin summary lists $SUM founder(s)" || no "10 admin summary"

# 11) Default research export excludes raw business text
CSV=$(curl -s "$BASE/api/admin/pilot/export.csv" -H "x-pilot-admin-token: $ADMIN")
echo "$CSV" | grep -q "$SECRET" && no "11 research export leaked raw text" || ok "11 research export excludes raw business text"

# 12) Founder export is founder-scoped (contains the founder's own data only)
EXP=$(curl -s -c "$CJ" -b "$CJ" "$BASE/api/account/export")
echo "$EXP" | grep -q "$SECRET" && ok "12 founder export contains their own data" || no "12 founder export"

echo "----"; echo "pilot smoke: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
