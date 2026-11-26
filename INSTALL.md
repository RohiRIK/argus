# Installing Argus

Argus runs locally under Bun or in a single container via Docker Compose (x86_64 and ARM64). Both local and Docker flows are driven by the one-command installer.

```bash
./install.sh              # local prod (Bun)      → http://localhost:8100
./install.sh dev          # local isolated dev    → http://localhost:8101 (ARGUS_ENV=dev)
./install.sh docker       # containerized prod    → http://localhost:8100
./install.sh docker-dev   # containerized dev     → http://localhost:8101
```

The installer is idempotent — re-running it is safe.

---

## For an AI agent

```text
This repo is "Argus", a self-hosted Microsoft 365 reporting app (Bun + Next.js 16 + SQLite, single container).
Read README.md, then run `./install.sh` for prod or `./install.sh dev` for an isolated dev instance (`http://localhost:8101`, `./data/argus-dev.db`).
For containers run `./install.sh docker` or `./install.sh docker-dev`.
The ONLY required secret is ARGUS_MASTER_KEY — install.sh generates it into .env automatically.
When it's up, confirm GET /api/health returns {"status":"healthy"}.
```

---

## Prerequisites

| Mode | Needs |
|------|-------|
| Local | [Bun](https://bun.sh) 1.3+, `openssl` |
| Docker | Docker (with Compose), `openssl` |

---

## The master key

`ARGUS_MASTER_KEY` is the **only** required secret: 32 bytes as 64 hex characters. It encrypts the credential vault (AES-256-GCM). `install.sh` generates one into `.env` on first run and reuses it after.

To make one yourself:

```bash
export ARGUS_MASTER_KEY=$(openssl rand -hex 32)
```

> ⚠️ If the key is lost, every stored credential becomes **irrecoverable**. Back up `.env`.

All other secrets (Entra ID tenant/client IDs, private key / secret, mailbox address) are configured in **Settings → Integrations** and stored encrypted in SQLite — never in `.env`.

---

## Manual install (local)

```bash
bun install
export ARGUS_MASTER_KEY=$(openssl rand -hex 32)
bun run db:migrate      # apply schema + indexes to ./data/argus.db
bun run db:seed         # 26 default report templates + integration record
bun run dev             # prod port → http://localhost:8100
# or side-by-side isolated dev:
bun run dev:isolated    # ARGUS_ENV=dev, PORT=8101, ARGUS_DB_PATH=./data/argus-dev.db
```

## Manual install (Docker)

Prebuilt multi-arch images (`linux/amd64`, `linux/arm64`) are published to GHCR as `ghcr.io/rohirik/argus:latest` (`main`), `ghcr.io/rohirik/argus:dev` (`dev`), and version tags `v*`.

```bash
export ARGUS_MASTER_KEY=$(openssl rand -hex 32)
docker compose up --build -d                        # prod (port 8100, argus-data)
docker compose -f docker-compose.dev.yml up -d      # isolated dev (port 8101, argus-dev-data)
```

Health check:

```bash
curl -s http://localhost:8100/api/health
# Anonymous: {"success":true,"data":{"status":"healthy","timestamp":"..."}}

# Full detail needs the operator access key:
curl -s -H "Authorization: Bearer $(bun run --silent auth:access-key)" http://localhost:8100/api/health
```

---

## Access and exposure

Every page and API route requires the **operator access key**, except the sign-in
page and a minimal `/api/health` (status only). The key is derived from
`ARGUS_MASTER_KEY`, so there is no extra secret to store:

```bash
bun run auth:access-key                  # local install
docker exec argus bun run auth:access-key  # Docker (argus-dev for the dev container)
```

Enter it on the sign-in page (sessions last 12 hours), or send it as
`Authorization: Bearer <key>` from scripts. Treat it like a password. Changing the
master key changes the access key and signs everyone out.

Docker Compose publishes the port on **`127.0.0.1` only**. To reach Argus from other
machines, set `ARGUS_BIND=0.0.0.0` in `.env`. The container serves plain HTTP, so do this
on a trusted network: the access key travels unencrypted when you sign in. `ARGUS_AUTH_MODE=off`
removes the gate and is only for a host nobody else can reach.

---

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ARGUS_MASTER_KEY` | — (required) | Vault encryption key (64 hex chars) |
| `PORT` | `8100` | HTTP port (`8101` for `dev:isolated` / `start:dev`) |
| `ARGUS_ENV` | `production` | Runtime label (`production` \| `staging` \| `dev`) shown in `/api/health` & sidebar badge |
| `ARGUS_DB_PATH` | `./data/argus.db` | SQLite file path |
| `ARGUS_MAX_CONCURRENT_RUNS` | `4` | Max scheduled jobs running Graph queries at once |
| `ARGUS_AUTH_MODE` | `access-key` | Operator access gate; `off` only on an unreachable host |
| `ARGUS_BIND` | `127.0.0.1` | Docker Compose only: host interface the port is published on |

---

## First-run configuration

1. Open **`http://localhost:8100`** (or **`http://localhost:8101`** for isolated dev) and sign in with the access key (`bun run auth:access-key`).
2. **Settings → Integrations → Quick Setup:** click **Deploy to Microsoft 365**, complete Microsoft Device Login, and Argus generates an RSA-2048 X.509 certificate, creates the Entra App Registration, grants all 16 Graph scopes, and verifies connectivity automatically.
3. **Optional — dedicated sender mailbox & custom settings (`Advanced`):** switch to **Advanced** on Integrations to select an existing M365 mailbox or generate the Exchange Online Shared Mailbox + RBAC-for-Applications PowerShell script (`argus@yourdomain.com`), then send a verification email.
4. **Settings → Recipients:** click **Create standard groups (3)** or create/link Entra ID Security Groups and attach them to jobs or Global Settings.
5. **Catalog / Dashboard:** deploy the 4 starter reports from the onboarding card or pick any of the 26 catalog reports to schedule a job.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `/api/health` 500 `no such table: vault` | Run `bun run db:migrate && bun run db:seed` (the installer does this). |
| `docker compose down` errors about `ARGUS_MASTER_KEY` | Export `ARGUS_MASTER_KEY` first (`export ARGUS_MASTER_KEY=$(grep ^ARGUS_MASTER_KEY= .env \| cut -d= -f2)`). |
| Device Login blocked by Conditional Access | Switch to **Settings → Integrations → Advanced**, generate the local certificate, upload the public `.cer` with the `az CLI` / `PowerShell` snippet, and enter Client ID / Tenant ID manually. |
| Sign-in page says the key is not valid | Print it again with `bun run auth:access-key` using the same `ARGUS_MASTER_KEY` as the server (`docker exec argus …` for containers). |
| Can't reach Argus from another machine | Compose binds `127.0.0.1` by default; use a reverse proxy or `ARGUS_BIND=0.0.0.0`. |
| Port 8100 in use | Set `PORT`, run `bun run dev:isolated` (`8101`), or stop the other process. |
| Credentials won't decrypt after a key change | The master key must match the one used to encrypt; restore the original `.env`. |

---

Powered by caffeine and questionable life choices.
