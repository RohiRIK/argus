# Argus — Manual Initial Setup

End-to-end first-time setup: stand up Argus, register the Microsoft Entra app
(including the **OAuth callback URL**), connect the tenant, and grant the Graph
permissions. Allow ~15 minutes.

> **You need:** a Microsoft 365 tenant where you are a **Global Administrator**, and
> a host with [Bun](https://bun.sh) 1.3+ (or Docker).

---

## Overview

Argus talks to Microsoft Graph with **app-only (application) permissions**. Setup is:

1. **Run Argus** (one required secret: `ARGUS_MASTER_KEY`).
2. **Register an Entra app** — get Tenant ID / Client ID / Client Secret, add the **redirect (callback) URI**.
3. **Connect** Argus to the tenant (Settings → Integrations).
4. **Grant permissions** — click **Authorize** (or run the one-time script). This is the step that
   *appends the permissions to the app registration and consents them*.
5. **Verify** — Test Connection greens; create + run a job.

A fresh app registration starts with only `User.Read`. The 13 application permissions Argus needs
are **not** added by hand — the **Authorize** flow (or the fallback script) appends and grants them.

---

## Part A — Run Argus

```bash
bun install
export ARGUS_MASTER_KEY=$(openssl rand -hex 32)   # 64 hex chars — the ONLY required secret
bun run db:migrate      # create the local SQLite database
bun run db:seed         # seed report templates
bun run dev             # → http://localhost:8100   (prod: bun run start)
```

- `ARGUS_MASTER_KEY` encrypts all stored credentials (AES-256-GCM). It lives **only in process
  memory** and is never persisted or logged. **If lost, stored credentials are irrecoverable** — keep it safe.
- Argus serves on **port 8100** (both `dev` and `start`). Confirm `GET http://localhost:8100/api/health` → `{"status":"healthy"}`.
- Optional env (`.env.schema`): `ARGUS_DB_PATH` (SQLite file location; defaults under the local `data/` folder), `ARGUS_MAX_CONCURRENT_RUNS` (default 4).

> Shortcut: `./install.sh` (local) or `./install.sh docker` does install + key + migrate + seed + serve.

---

## Part B — Register the Microsoft Entra app

In the [Entra admin center](https://entra.microsoft.com) → **Identity → Applications → App registrations**.

### B1. New registration
1. **New registration**. Name: `Argus` (or `argus - test`).
2. Supported account types: **Accounts in this organizational directory only** (single tenant).
3. **Register**.
4. On **Overview**, copy:
   - **Directory (tenant) ID** → Argus **Tenant ID**
   - **Application (client) ID** → Argus **Client ID**

### B2. Client secret
1. **Certificates & secrets → Client secrets → New client secret**.
2. Description `argus`, expiry per your policy → **Add**.
3. **Copy the secret _Value_ immediately** (shown once) → Argus **Client Secret**.

### B3. Redirect (callback) URI — required for the Authorize button
The in-app **Authorize** flow is an OAuth sign-in; Microsoft must know where to return.

1. **Authentication → Add a platform → Web**.
2. **Redirect URI** — add the Argus callback:

   ```
   http://localhost:8100/api/integrations/microsoft365/authorize/callback
   ```

   For a deployed instance use that origin instead, e.g.
   `https://argus.example.com/api/integrations/microsoft365/authorize/callback`.
   You can register **multiple** redirect URIs (localhost + prod).
3. Leave "Access tokens" / "ID tokens" implicit-grant checkboxes **unchecked** (Argus uses the auth-code flow).
4. **Save**.

> Argus shows this exact URI in **Settings → Integrations → One-time setup**.

### B4. Shared mailbox (for sending reports)
Reports are emailed via Graph `sendMail` from a shared mailbox. Note the address (e.g.
`argus@yourdomain`). `Mail.Send` is included in the permissions granted in Part D.

> You do **not** add API permissions by hand here — Part D does that for you.

---

## Part C — Connect Argus to the tenant

1. Open **http://localhost:8100 → Settings → Integrations → Microsoft 365**.
2. Enter and **Save credentials**:
   - **Entra ID Tenant ID** (B1)
   - **Entra ID Client ID** (B1)
   - **Entra ID Client Secret** (B2)
   - **Shared Mailbox Email** (B4)
3. Click **Test Connection** → expect **Auth OK** (proves tenant/client/secret). Permissions will
   still show as missing — that's Part D.

---

## Part D — Grant the Graph permissions

Pick one path. Both append the permissions to the app registration **and** consent them.

### Option 1 — Authorize button (recommended)
1. Settings → Integrations → **Authorize** (also available on the **Catalog** banner and the **job** form).
2. Sign in with your **Global Admin** account.
3. On **Permissions requested**, click **Accept**. You do **not** need to tick *"Consent on behalf of
   your organization"* — accepting as admin is enough (least privilege). The requested delegated scopes
   are `offline_access`, `Application.ReadWrite.All`, `AppRoleAssignment.ReadWrite.All`, `openid`.
4. You're redirected back to Argus (`?authorized=ok`). Argus uses that one-time session to declare +
   grant the 13 application permissions. Click **Re-validate** → status should go **green**.

> The delegated token is used only during the callback and is never stored. After it works you may
> revoke Argus's delegated grant in **Enterprise applications → (Argus) → Permissions** — the granted
> app-only permissions keep working.

### Option 2 — One-time PowerShell script (no redirect URI needed)
Settings → Integrations → **One-time setup** → copy the script → run once as a Global Admin
(local PowerShell with the Microsoft.Graph module, or Azure Cloud Shell). It **declares + grants**
all scopes in your own session, then click **Re-validate**.

### The 13 application permissions (granted for you)
`Application.Read.All`, `AuditLog.Read.All`, `DeviceManagementManagedDevices.Read.All`,
`Directory.Read.All`, `IdentityRiskEvent.Read.All`, `IdentityRiskyServicePrincipal.Read.All`,
`IdentityRiskyUser.Read.All`, `Mail.Send`, `Organization.Read.All`, `Reports.Read.All`,
`SecurityEvents.Read.All`, `User.Read.All`, `UserAuthenticationMethod.Read.All`.

After granting, the Entra app's **API permissions → Configured permissions** lists them (the script's
`Update-MgApplication` / the Authorize flow's manifest PATCH declares them so the portal reflects reality).

---

## Part E — Verify it works

1. **Settings → Integrations → Test Connection** → **green** (auth ok, all permissions granted, mailbox configured).
2. **Catalog** → pick a report → **Create job** (the "Permissions required" banner should be gone).
3. On a job card → **Run** → open the execution → confirm it fetched data and (if conditions met) sent email.
4. Optional: a job's **Test-send** emails a `[TEST]` sample to your admin contacts.

---

## Reference

| Item | Value |
|------|-------|
| App URL / port | `http://localhost:8100` |
| Health check | `GET /api/health` → `{"status":"healthy"}` |
| Required secret | `ARGUS_MASTER_KEY` (64 hex; `openssl rand -hex 32`) |
| Redirect (callback) URI | `<origin>/api/integrations/microsoft365/authorize/callback` |
| Credentials stored | Tenant ID, Client ID, Client Secret, Shared Mailbox (AES-256-GCM in the DB vault) |
| DB | SQLite file at `ARGUS_DB_PATH` (defaults under the local `data/` folder) |

---

## Troubleshooting

- **`AADSTS50011` redirect mismatch** on Authorize → the redirect URI in B3 doesn't match the app's
  origin. Add the exact `<origin>/api/integrations/microsoft365/authorize/callback` (scheme + host + port).
- **"Consent pending — can't read grants yet"** after saving creds → normal before granting; run Part D.
- **All 13 still show missing after "Grant admin consent"** → that button only consents *already-declared*
  permissions. Use **Authorize** (Option 1) or the script (Option 2), which **declare** them first.
- **Auth fails (not permissions)** → re-check Tenant ID / Client ID / Client Secret; the secret **Value**
  (not the secret ID), and that it hasn't expired.
- **Email not sending** → confirm the Shared Mailbox exists and `Mail.Send` is granted (Part D); the
  mailbox must be a real, licensed/shared mailbox in the tenant.
- **Lost `ARGUS_MASTER_KEY`** → stored credentials can't be decrypted; set a new key and re-enter creds.

---

## Security notes

- Argus runs day-to-day with **app-only read** permissions + `Mail.Send` — least privilege.
- The elevated write scopes (`Application.ReadWrite.All`, `AppRoleAssignment.ReadWrite.All`) are only
  consented to **you (the admin), transiently**, for the one-time grant — Argus never holds them as
  app-only permissions and never stores the delegated token.
- Master key in process memory only; vault values AES-256-GCM encrypted at rest; secrets never logged.
