#!/usr/bin/env bash
# Smoke-test a running Argus instance. Usage: scripts/smoke.sh [BASE_URL]
set -euo pipefail
BASE="${1:-http://localhost:3000}"

echo "→ health"
curl -fsS "$BASE/api/health" | grep -q '"status":"healthy"' && echo "  ✓ healthy"

echo "→ catalog (expect 12)"
n=$(curl -fsS "$BASE/api/catalog" | grep -o '"id"' | wc -l | tr -d ' ')
[ "$n" = "12" ] && echo "  ✓ $n reports" || { echo "  ✗ got $n"; exit 1; }

echo "→ templates seeded (expect >=12)"
t=$(curl -fsS "$BASE/api/templates" | grep -o '"id"' | wc -l | tr -d ' ')
[ "$t" -ge 12 ] && echo "  ✓ $t templates" || { echo "  ✗ got $t"; exit 1; }

echo "→ create + run a job"
jid=$(curl -fsS -X POST "$BASE/api/jobs" -H 'content-type: application/json' \
  -d '{"name":"smoke","reportType":"sign-in-anomalies","scheduleType":"preset","schedulePreset":"daily","recipients":["s@x.com"]}' \
  | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
echo "  job=$jid"
curl -fsS -X POST "$BASE/api/jobs/$jid/run" >/dev/null && echo "  ✓ ran"

echo "All smoke checks passed."
