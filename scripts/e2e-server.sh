#!/usr/bin/env bash
# Prepare an isolated DB and serve the built app for Playwright E2E.
set -euo pipefail

export ARGUS_MASTER_KEY="${ARGUS_MASTER_KEY:-$(openssl rand -hex 32)}"
export ARGUS_DB_PATH="${ARGUS_DB_PATH:-$PWD/data/e2e.db}"
export NODE_ENV=production
PORT="${E2E_PORT:-3993}"

rm -f "$ARGUS_DB_PATH" "$ARGUS_DB_PATH-shm" "$ARGUS_DB_PATH-wal"
bun run db:migrate
bun run db:seed
exec bun --bun next start -p "$PORT"
