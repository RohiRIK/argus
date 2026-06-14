#!/usr/bin/env bash
#
# Argus one-command installer.
#
#   ./install.sh           # local dev (Bun)      → http://localhost:3000
#   ./install.sh docker    # containerized (Docker Compose)
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

if [ "$MODE" = "docker" ]; then
  command -v docker >/dev/null 2>&1 || die "Docker is not installed."
  say "Building and starting the container…"
  # shellcheck disable=SC1091
  export ARGUS_MASTER_KEY="$(grep '^ARGUS_MASTER_KEY=' .env | cut -d= -f2)"
  docker compose up --build -d
  say "Waiting for health…"
  for _ in $(seq 1 60); do
    curl -fs http://localhost:3000/api/health 2>/dev/null | grep -q healthy && { say "Healthy → http://localhost:3000"; exit 0; }
    sleep 1
  done
  die "Container did not become healthy in time — check: docker compose logs"
fi

# Local dev path.
command -v bun >/dev/null 2>&1 || die "Bun is not installed. See https://bun.sh"
say "Installing dependencies…"
bun install
say "Applying migrations…"
bun run db:migrate
say "Seeding default templates + integrations…"
bun run db:seed
say "Starting dev server → http://localhost:3000  (Ctrl-C to stop)"
exec bun run dev
