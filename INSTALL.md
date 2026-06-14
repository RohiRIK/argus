# Installing Argus

Argus runs two ways: **local dev** (Bun on your machine) or **containerized**
(Docker Compose). Both are driven by the one-command installer.

```bash
./install.sh            # local dev    → http://localhost:8100
./install.sh docker     # containers   → http://localhost:8100
```

The installer is idempotent — re-running it is safe.

---

## For an AI agent

```text
This repo is "Argus", a self-hosted Microsoft 365 reporting app (Bun + Next.js 16 + SQLite, single container).
Read README.md, then run `./install.sh` for local dev or `./install.sh docker` for containers.
The ONLY required secret is ARGUS_MASTER_KEY — install.sh generates it into .env automatically.
When it's up, open http://localhost:8100 and confirm GET /api/health returns {"status":"healthy"}.
```

---

## Prerequisites

| Mode | Needs |
|------|-------|
| Local | [Bun](https://bun.sh) 1.3+, `openssl` |
| Docker | Docker (with Compose), `openssl` |

---

## The master key

`ARGUS_MASTER_KEY` is the **only** required secret: 32 bytes as 64 hex characters. It
encrypts the credential vault (AES-256-GCM). `install.sh` generates one into `.env` on
first run and reuses it after.

To make one yourself:

```bash
export ARGUS_MASTER_KEY=$(openssl rand -hex 32)
```

> ⚠️ If the key is lost, every stored credential becomes **irrecoverable**. Back up `.env`.

All other secrets (Entra ID tenant/client/secret, mailbox address) are entered through the
UI under **Settings → Credentials** and stored encrypted in the database — never in `.env`.

---

## Manual install (local)

```bash
bun install
export ARGUS_MASTER_KEY=$(openssl rand -hex 32)
bun run db:migrate      # apply schema + indexes to ./data/argus.db
bun run db:seed         # 12 report templates + default integration
bun run dev             # http://localhost:8100
```

## Manual install (Docker)

```bash
export ARGUS_MASTER_KEY=$(openssl rand -hex 32)
docker compose up --build -d
# Compose interpolates ARGUS_MASTER_KEY from your shell — it must be exported
# for `up` AND `down`.
```

Health check:

```bash
curl -s http://localhost:8100/api/health
# {"success":true,"data":{"status":"healthy","db":{"connected":true,...}}}
```

---

## Optional environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `ARGUS_MASTER_KEY` | — (required) | Vault encryption key (64 hex chars) |
| `PORT` | `8100` | HTTP port |
| `ARGUS_DB_PATH` | `./data/argus.db` | SQLite file path |
| `ARGUS_MAX_CONCURRENT_RUNS` | `4` | Max scheduled jobs running Graph queries at once |

---

## First-run configuration

1. Open **http://localhost:8100**.
2. **Settings → Credentials**: enter Entra ID tenant ID, client ID, client secret, and the
   scoped mailbox address; **Test Connection**.
3. **Catalog**: pick a report → it opens the template editor → **Create job** with schedule,
   recipients, and conditional rules.
4. Watch runs on the **Dashboard**; inspect output and **Logs** per execution.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `/api/health` 500 `no such table: vault` | Run `bun run db:migrate && bun run db:seed` (the installer does this). |
| `docker compose down` errors about `ARGUS_MASTER_KEY` | Compose needs the var even to tear down: `export ARGUS_MASTER_KEY=$(grep ^ARGUS_MASTER_KEY= .env \| cut -d= -f2)` first. |
| Port 8100 in use | Set `PORT`, or stop the other process. |
| Credentials won't decrypt after a key change | The master key must match the one used to encrypt; restore the original `.env`. |

---

Powered by caffeine and life-questionable choices.
