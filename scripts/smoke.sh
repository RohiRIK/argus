#!/usr/bin/env bash
# Smoke-test a running Argus instance. Usage: scripts/smoke.sh [BASE_URL]
set -euo pipefail
BASE="${1:-http://localhost:8100}"
# Protected routes need the operator access key (bun run auth:access-key).
AUTH=()
if [ -n "${ARGUS_ACCESS_KEY:-}" ]; then
  AUTH=(-H "Authorization: Bearer $ARGUS_ACCESS_KEY")
fi
curlA() { curl "${AUTH[@]}" "$@"; }

echo "→ anonymous access is denied"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/jobs")
if [ -n "${ARGUS_ACCESS_KEY:-}" ]; then
  [ "$code" = "401" ] && echo "  ✓ 401" || { echo "  ✗ got $code"; exit 1; }
else
  echo "  (skipped: ARGUS_ACCESS_KEY not set, assuming ARGUS_AUTH_MODE=off)"
fi

echo "→ health"
curl -fsS "$BASE/api/health" | grep -q '"status":"healthy"' && echo "  ✓ healthy"

echo "→ catalog (expect >=26)"
n=$(curlA -fsS "$BASE/api/catalog" | grep -o '"id"' | wc -l | tr -d ' ')
[ "$n" -ge 26 ] && echo "  ✓ $n reports" || { echo "  ✗ got $n"; exit 1; }

echo "→ templates seeded (expect >=26)"
t=$(curlA -fsS "$BASE/api/templates" | grep -o '"id"' | wc -l | tr -d ' ')
[ "$t" -ge 26 ] && echo "  ✓ $t templates" || { echo "  ✗ got $t"; exit 1; }

echo "→ create + run + cleanup job"
jid=$(curlA -fsS -X POST "$BASE/api/jobs" -H 'content-type: application/json' \
  -d '{"name":"smoke","reportType":"sign-in-anomalies","scheduleType":"preset","schedulePreset":"daily","recipients":["s@x.com"]}' \
  | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
echo "  job=$jid"
curlA -fsS -X POST "$BASE/api/jobs/$jid/run" >/dev/null && echo "  ✓ ran"
curlA -fsS -X DELETE "$BASE/api/jobs/$jid" >/dev/null && echo "  ✓ cleaned up"

echo "All smoke checks passed."
