# Installing Argus

Argus runs locally under Bun or in a single container via Docker Compose (x86_64 and ARM64). Both local and Docker flows are driven by the one-command installer.

```bash
./install.sh              # local prod (Bun)      → http://localhost:8100
./install.sh dev          # local isolated dev    → http://localhost:8101 (ARGUS_ENV=dev)
./install.sh docker       # containerized prod    → https://localhost:8100
./install.sh docker-dev   # containerized dev     → https://localhost:8101
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

The container serves **HTTPS only** (see [HTTPS](#https) below). Health check:

```bash
docker cp argus:/app/data/tls/cert.pem ./argus-cert.pem   # the container's own certificate
curl -s --cacert ./argus-cert.pem https://localhost:8100/api/health
# Anonymous: {"success":true,"data":{"status":"healthy","timestamp":"..."}}

# Full detail needs a signed-in session, or the machine key for scripts:
curl -s --cacert ./argus-cert.pem \
  -H "Authorization: Bearer $(docker exec argus bun run --silent auth:access-key)" \
  https://localhost:8100/api/health
```

---

## HTTPS

The container terminates TLS itself; no reverse proxy is needed. Next.js listens on
`127.0.0.1:8180` inside the container only, and a small Bun HTTPS front on port `8100`
forwards to it.

- **First boot:** Argus generates a self-signed certificate (RSA-2048, 397 days) for
  `localhost`, `127.0.0.1`, `::1` and any names in `ARGUS_TLS_HOSTNAMES`, and keeps it in
  the data volume (`/app/data/tls/`). The private key is stored AES-256-GCM encrypted
  with `ARGUS_MASTER_KEY`. The SHA-256 fingerprint is printed in `docker logs argus`.
- **Renewal:** regenerated automatically at boot when it is within 30 days of expiry,
  when `ARGUS_TLS_HOSTNAMES` changes, or when the master key changes.
- **Browser warning:** expected for a self-signed certificate. Compare the fingerprint
  with the one in the logs once, or import `/app/data/tls/cert.pem` into your trust store.
- **Your own certificate:** mount the files and set `ARGUS_TLS_CERT_FILE` and
  `ARGUS_TLS_KEY_FILE` (see the comment in `docker-compose.yml`). Argus then also sends HSTS.
- **Reach it by name or IP:** add them, e.g. `ARGUS_TLS_HOSTNAMES=argus.lan,192.168.1.20`,
  then `docker compose up -d` to regenerate.
- `ARGUS_TLS=off` serves plain HTTP on port `8100` (local experiments only).

Local Bun runs (`./install.sh`, `bun run dev`) stay on plain `http://localhost`.

---

## Access and exposure

Every page and API route requires signing in with a **username and password**, except
the sign-in page and a minimal `/api/health` (status only).

- **First run:** open Argus and create the admin account on the sign-in page. For safety
  this is only possible within **30 minutes** of Argus starting; after that, restart Argus
  or create the account on the host (below).
- **Sessions** last 12 hours. Change your password under **Settings → Account**.
- **5 wrong passwords** lock that username for 15 minutes.
- **Forgot the password / setup window closed:** on the host, set a new random password
  (it also creates the account if it doesn't exist):

```bash
bun run auth:reset-password admin                    # local install
docker exec argus bun run auth:reset-password admin  # Docker (argus-dev for the dev container)
```

Passwords are stored as argon2id hashes. Scripts and CI can still call the API with
`Authorization: Bearer $(bun run --silent auth:access-key)` (a machine key derived from
`ARGUS_MASTER_KEY`); it is not needed for normal use. Changing the master key signs everyone out.

Docker Compose publishes HTTPS on **all interfaces** (`ARGUS_BIND=0.0.0.0`), so other
machines can reach `https://<host>:8100` directly. Set `ARGUS_BIND=127.0.0.1` to keep it on
this machine only. `ARGUS_AUTH_MODE=off` removes the gate and is only for a host nobody
else can reach.

---

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ARGUS_MASTER_KEY` | — (required) | Vault encryption key (64 hex chars) |
| `PORT` | `8100` | HTTP port (`8101` for `dev:isolated` / `start:dev`) |
| `ARGUS_ENV` | `production` | Runtime label (`production` \| `staging` \| `dev`) shown in `/api/health` & sidebar badge |
| `ARGUS_DB_PATH` | `./data/argus.db` | SQLite file path |
| `ARGUS_MAX_CONCURRENT_RUNS` | `4` | Max scheduled jobs running Graph queries at once |
| `ARGUS_AUTH_MODE` | `access-key` | Sign-in required (username + password); `off` only on an unreachable host |
| `ARGUS_BIND` | `0.0.0.0` | Docker Compose only: host interface the port is published on |
| `ARGUS_TLS` | `on` | Container: HTTPS on `PORT` (`off` = plain HTTP) |
| `ARGUS_TLS_HOSTNAMES` | — | Extra names/IPs for the self-signed certificate (comma separated) |
| `ARGUS_TLS_CERT_FILE` / `ARGUS_TLS_KEY_FILE` | — | Your own PEM certificate and key (both or neither) |
| `ARGUS_INTERNAL_PORT` | `8180` | Container: loopback port of the app behind the HTTPS front |

---

## First-run configuration

1. Open **`http://localhost:8100`** (local Bun) or **`https://localhost:8100`** (Docker; `8101` for isolated dev) and create the admin account (username + password) on first visit.
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
| Forgot the password, or "first-time setup has timed out" | `docker exec argus bun run auth:reset-password <username>` (local: `bun run auth:reset-password <username>`) prints a new password. |
| "Too many failed attempts" | Wait 15 minutes, or reset the password on the host. |
| Can't reach Argus from another machine | Use `https://` (plain HTTP is refused), check `ARGUS_BIND` is not `127.0.0.1`, and add the name/IP to `ARGUS_TLS_HOSTNAMES`. |
| Browser says the certificate is not trusted | Expected for the self-signed certificate. Check the fingerprint in `docker logs argus`, or use your own with `ARGUS_TLS_CERT_FILE`/`ARGUS_TLS_KEY_FILE`. |
| Port 8100 in use | Set `PORT`, run `bun run dev:isolated` (`8101`), or stop the other process. |
| Credentials won't decrypt after a key change | The master key must match the one used to encrypt; restore the original `.env`. |

---

Powered by caffeine and questionable life choices.
