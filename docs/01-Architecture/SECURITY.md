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
- Health check: `curl -f http://localhost:8100/api/health`

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
- Unauthorized access (no auth yet, but single-tenant)
- Data leakage (masked values, typed errors)
- Throttling (bounded run queue)

### Not Protected Against

- Physical access to host
- Compromised master key
- Malicious admin (single-tenant assumption)
- Network interception (HTTPS recommended for production)

---

## Future: Auth / RBAC

PRD A1 calls for login gate. Currently no auth on API endpoints (single-tenant, self-hosted assumption).

---

**References:**
- [Services Layer](./SERVICES.md) — Vault and auth implementations
- [Database Layer](./DATABASE.md) — Vault table schema
- [Architecture](./ARCHITECTURE.md) — System overview
