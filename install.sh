#!/usr/bin/env bash
#
# Argus one-command installer.
#
#   ./install.sh              # local prod (Bun)        → http://localhost:8100
#   ./install.sh dev          # local isolated dev      → http://localhost:8101
#   ./install.sh docker       # containerized prod      → http://localhost:8100
#   ./install.sh docker-dev   # containerized dev       → http://localhost:8101
#
# Idempotent: safe to re-run. Generates an encrypted-vault master key into .env
# on first run (never overwrites an existing one).

set -euo pipefail

MODE="${1:-local}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

say() { printf '\033[1;36m[argus]\033[0m %s\n' "$1"; }
die() { printf '\033[1;31m[argus] %s\033[0m\n' "$1" >&2; exit 1; }

# 1. Master key — the ONE required secret. 32 bytes as 64 hex chars.
if [ ! -f .env ] || ! grep -q '^ARGUS_MASTER_KEY=.\+' .env 2>/dev/null; then
  command -v openssl >/dev/null 2>&1 || die "openssl is required to generate ARGUS_MASTER_KEY"
  KEY="$(openssl rand -hex 32)"
  if [ -f .env ]; then
    # replace an empty key line or append
    grep -q '^ARGUS_MASTER_KEY=' .env \
      && sed -i.bak "s|^ARGUS_MASTER_KEY=.*|ARGUS_MASTER_KEY=$KEY|" .env && rm -f .env.bak \
      || printf 'ARGUS_MASTER_KEY=%s\n' "$KEY" >> .env
  else
    printf 'ARGUS_MASTER_KEY=%s\n' "$KEY" > .env
  fi
  say "Generated ARGUS_MASTER_KEY into .env (keep it safe — lost key = unrecoverable credentials)."
else
  say "Reusing existing ARGUS_MASTER_KEY from .env."
fi

if [ "$MODE" = "docker" ] || [ "$MODE" = "docker-dev" ]; then
  command -v docker >/dev/null 2>&1 || die "Docker is not installed."
  # shellcheck disable=SC1091
  export ARGUS_MASTER_KEY="$(grep '^ARGUS_MASTER_KEY=' .env | cut -d= -f2)"
  if [ "$MODE" = "docker-dev" ]; then
    say "Building and starting isolated dev container (port 8101)…"
    export ARGUS_DEV_MASTER_KEY="${ARGUS_DEV_MASTER_KEY:-$ARGUS_MASTER_KEY}"
    docker compose -f docker-compose.dev.yml up --build -d
    TARGET_PORT="${DEV_PORT:-8101}"
    CONTAINER=argus-dev
  else
    say "Building and starting production container (port 8100)…"
    docker compose up --build -d
    TARGET_PORT="${PORT:-8100}"
    CONTAINER=argus
  fi
  say "Waiting for health…"
  for _ in $(seq 1 60); do
    curl -fs "http://localhost:${TARGET_PORT}/api/health" 2>/dev/null | grep -q healthy && { say "Healthy → http://localhost:${TARGET_PORT}"; say "Sign in with the access key: docker exec ${CONTAINER} bun run auth:access-key"; exit 0; }
    sleep 1
  done
  die "Container did not become healthy in time — check: docker compose logs"
fi

# Local path.
command -v bun >/dev/null 2>&1 || die "Bun is not installed. See https://bun.sh"
if [ "$MODE" = "dev" ]; then
  export ARGUS_ENV=dev
  export PORT="${PORT:-8101}"
  export ARGUS_DB_PATH="${ARGUS_DB_PATH:-./data/argus-dev.db}"
fi
say "Installing dependencies…"
bun install
say "Applying migrations…"
bun run db:migrate
say "Seeding default templates + integrations…"
bun run db:seed
say "Sign in with the access key printed by: bun run auth:access-key"
if [ "$MODE" = "dev" ]; then
  say "Starting isolated dev server → http://localhost:${PORT} (DB: ${ARGUS_DB_PATH})  (Ctrl-C to stop)"
  exec bun run dev
fi
say "Starting dev server → http://localhost:8100  (Ctrl-C to stop)"
exec bun run dev
