# Security Architecture

> **Purpose:** Credential management, authentication, authorization, and audit
> **Location:** `src/services/vault/`, `src/services/graph/auth.ts`, `src/services/graph/permissions-grant.ts`

---

## Overview

Argus follows a least-privilege security model:

1. **One secret:** `ARGUS_MASTER_KEY` (env var, memory only)
2. **Encrypted vault:** All other credentials stored AES-256-GCM
3. **App-only permissions:** No user interaction for day-to-day operations
4. **Scoped mailbox:** Exchange Online RBAC limits email to single mailbox
5. **Audit trail:** Permission grants logged

---

## Master Key

### Source

`ARGUS_MASTER_KEY` environment variable (64 hex chars = 32 bytes).

### Storage

**Process memory only.** Never:
- Persisted to disk
- Logged
- Sent in API responses
- Stored in database

### Usage

Decrypts vault credentials on demand. If lost, stored credentials are irrecoverable.

### Generation

```bash
openssl rand -hex 32
```

---

## Encrypted Vault

### Architecture

```
User enters credential in UI
   │
   ▼
API validates input
   │
   ▼
Vault encrypts with AES-256-GCM
   │
   ├── Key: ARGUS_MASTER_KEY (memory only)
   ├── Per-value: unique IV + auth tag
   └── Stored in vault table (encrypted)
```

### Encryption

- **Algorithm:** AES-256-GCM
- **Key:** 256-bit from `ARGUS_MASTER_KEY`
- **Per-value:** Unique IV (12 bytes) + auth tag (16 bytes)
- **Encoding:** Base64 for storage

### Vault Keys

| Key | Purpose | Masked In UI |
|-----|---------|--------------|
| `tenantId` | Entra ID tenant | Partial (`xxx•••xxx`) |
| `clientId` | Entra ID app | Partial (`xxx•••xxx`) |
| `clientSecret` | Entra ID secret | Full (`••••••••`) |
| `mailbox` | Shared mailbox email | Partial (`xxx•••xxx`) |

### API Safety

- `vaultService.list()` returns masked values only
- `vaultService.get()` requires explicit key (not exposed in listings)
- Client secret never revealed in any response

---

## Microsoft Graph Authentication

### Flow

**Client Credentials** (app-only, daemon flow):
1. Acquire token from Entra ID using client ID + secret
2. Token cached until expiry (automatic refresh)
3. Used for all Graph API calls

### Token Acquisition

```typescript
// src/services/graph/auth.ts
acquireToken() → string  // Returns access token
```

- Uses `@azure/msal-node`
- Caches token in memory
- Refreshes automatically before expiry

---

## Graph Permissions

### Capabilities (H2)

Argus requests three independent capabilities (`src/services/graph/capabilities.ts`),
and Test Connection reports readiness for each:

| Capability | Scopes | Default |
|------------|--------|---------|
| Read reports | Union of every report's `requiredPermissions` | Always requested |
| Send email | `Mail.Send`, used only from the **effective sender** (Settings From address, else the vault mailbox) | Always requested |
| Manage Entra groups | `Group.ReadWrite.All` | **Off.** Opt in under Settings → Integrations |

With "Manage Entra groups" off, Argus does not request `Group.ReadWrite.All` (app
permission or the Quick Setup sign-in scope), Quick Setup and "Create standard groups"
create local recipient groups only, and creating Entra groups or changing their members
is refused with a clear message. Linking an existing Entra group (read) still works.
Turning the option off does not revoke a grant already given; remove it in Entra.
The executor, test-send and Test Connection all use the same `effectiveSender()`.

### Required Permissions (13)

| Permission | Purpose |
|-----------|---------|
| `AuditLog.Read.All` | Sign-ins, directory audits |
| `IdentityRiskyUser.Read.All` | Risky users report |
| `UserAuthenticationMethod.Read.All` | MFA registration |
| `Organization.Read.All` | License utilization |
| `Application.Read.All` | App secrets expiry |
| `SecurityEvents.Read.All` | Security alerts |
| `DeviceManagementManagedDevices.Read.All` | Device compliance |
| `User.Read.All` | Inactive users |
| `Directory.Read.All` | Provisioning logs |
| `IdentityRiskyServicePrincipal.Read.All` | Risky service principals |
| `IdentityRiskEvent.Read.All` | Risk detection events |
| `Reports.Read.All` | CSV usage reports |
| `Mail.Send` | Send report emails |

### Permission Grant Flow

Two-step authorization:

**Step 1: Authorize (OAuth consent)**
- User signs in as Global Admin
- Consents to bootstrap scopes:
  - `Application.ReadWrite.All`
  - `AppRoleAssignment.ReadWrite.All`
  - `offline_access`, `openid`
- Returns to Argus with delegated token

**Step 2: Grant (programmatic)**
- Argus uses bootstrap scopes to:
  1. Declare the 13 application permissions in app manifest
  2. Grant admin consent for each
- Delegated token discarded after use

### Read-Only Mode

When mailbox permissions are missing:
- Data can still be fetched
- Emails are skipped (not sent)
- Execution marked as `warning` (not `failed`)
- UI shows remediation instructions

---

## Exchange Online RBAC

### Purpose

Restrict the app to send email from a single shared mailbox only.

### Setup

```powershell
# Create management scope
New-ManagementScope -Name "ArgusScope" `
  -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'argus@tenant.com'"

# Assign role
New-ManagementRoleAssignment -Name "ArgusSendMail" `
  -Role ApplicationImpersonation `
  -App <ClientId> `
  -CustomRecipientWriteScope "ArgusScope"
```

### Validation

- Checked at startup
- Status stored in `settings.permissionStatus`
- UI shows `Test Connection` result
- Re-validate button for manual re-check

---

## Webhook Security

### Per-Endpoint

- Optional signing secret
- Custom payload template
- Delivery status tracking
- Retry: 3 attempts with exponential backoff

### Payload

Includes:
- Execution ID, job ID, job name
- Suppression reason
- Timestamp, records processed
- Full HTML report (optional)
- Graph API latency metadata

---

## Audit Trail

### Permission Grants

Logged in `audit` table:
- Action (e.g., `permission_grant`)
- Provider (e.g., `microsoft365`)
- Outcome (`success` | `partial` | `error`)
- Detail (JSON with operation details)
- Timestamp

### Execution History

All executions logged:
- Status, timestamps, records processed
- Email sent/recipients
- Webhook delivery status
- Error messages (if failed)
- Baseline snapshots

---

## Security Constraints

### Never

- Store secrets in `.env` beyond `ARGUS_MASTER_KEY`
- Expose stack traces to clients
- Log credentials or tokens
- Send credentials in API responses
- Use broad `Mail.Send` permission

### Always

- Encrypt credentials at rest (AES-256-GCM)
- Mask sensitive values in UI
- Use typed errors (never raw Error)
- Validate inputs (Zod schemas)
- Audit permission changes

---

## Deployment Security

### Docker

- Only `ARGUS_MASTER_KEY` as env var
- SQLite volume for persistence
- No secrets in docker-compose.yml
- HTTPS only: the container generates a self-signed certificate (key encrypted with the
  master key in `/app/data/tls/`) or uses `ARGUS_TLS_CERT_FILE`/`ARGUS_TLS_KEY_FILE`;
  Next.js listens on `127.0.0.1:8180` inside the container only
  (`scripts/container-start.ts`, `src/services/tls/`)
- Health check: Docker `HEALTHCHECK` probes the loopback app port

### First Run

1. Generate master key
2. Run Argus
3. Enter credentials in UI (encrypted immediately)
4. Grant permissions (one-time elevated)
5. Revoke elevated permissions after setup

---

## Threat Model

### Protected Against

- Credential theft (encrypted at rest)
- Privilege escalation (least-privilege RBAC)
- Unauthorized access (operator access gate on every page and API route)
- Data leakage (masked values, typed errors)
- Throttling (bounded run queue)

### Not Protected Against

- Physical access to host
- Compromised master key
- Malicious admin (single-tenant assumption)
- Network interception (HTTPS recommended for production)

---

## Operator Access Gate

`src/proxy.ts` runs before every request. Only `/login`, `/api/auth/login`,
`/api/auth/logout`, `/api/auth/setup`, static assets and `/api/health` are public;
anonymous `/api/health` returns only `status` and `timestamp`. Everything else needs one of:

- **Session cookie** `argus_session` from a username + password sign-in — `HttpOnly`,
  `SameSite=Lax`, `Secure` behind HTTPS, 12-hour expiry, HMAC-signed and naming the user
  (`v2.<expiresAt>.<username>.<sig>`), verified without a database lookup.
- **Bearer machine key** — `Authorization: Bearer argus_…` for scripts and CI smoke checks
  (identity `api-key`). Not shown in the UI.

The proxy forwards the authenticated identity as `x-argus-user` (a client-sent value is
always dropped); sign-ins, failures, setup and password changes are written to the audit trail.

### Accounts

- `users` table: username (lowercased, unique) and an **argon2id** hash (`Bun.password`).
- **First run:** while no account exists, `/login` offers "Create the admin account". It is
  open only for 30 minutes after the process starts so a stranger can't claim a fresh,
  reachable install; after that, restart or use the host CLI.
- **Lockout:** 5 failed sign-ins lock that username for 15 minutes (in memory). Unknown
  usernames cost the same as wrong passwords and return the same message.
- **Recovery:** `bun run auth:reset-password <username>` on the host sets a random
  password (creating the account if needed).

Anonymous API calls get `401 UnauthorizedError`; pages redirect to `/login?next=…`
(same-site paths only).

Both keys are derived from `ARGUS_MASTER_KEY` with HMAC-SHA256 under separate labels
(`src/lib/auth/access.ts`), so the gate adds no secret to `.env`:

| Derived value | Label | Purpose |
|---------------|-------|---------|
| Machine key | `argus:access-key:v1` | Bearer key for scripts/CI; print with `bun run auth:access-key` |
| Session key | `argus:session:v1` | Signs session cookies |

Rotating the master key rotates the machine key and ends every session.
`ARGUS_AUTH_MODE=off` disables the gate for a host nobody else can reach.
The HTTPS front overwrites client-sent `X-Forwarded-*` headers, so session cookies are
always `Secure` in the container. HSTS is sent only with a provided (CA-signed) certificate.

**Not yet:** roles (every account is a full operator), managing multiple accounts in the
UI (add more with the host CLI), and invalidating other sessions on a password change
(sessions expire after 12 hours).

---

**References:**
- [Services Layer](./SERVICES.md) — Vault and auth implementations
- [Database Layer](./DATABASE.md) — Vault table schema
- [Architecture](./ARCHITECTURE.md) — System overview
