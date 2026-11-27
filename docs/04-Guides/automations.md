# Automations Guide

> **Last updated:** 2026-11-25

Automations fix what reports find. You browse them in the one **Catalog** next to the reports
(each card is tagged **Report** or **Automation**, automations also show their risk level), and
manage the ones you set up in the **Automations** section:

| Page | Route | Use it to |
|------|-------|-----------|
| Catalog | `/catalog?type=automation` | Browse the built-in automations, set one up (Audit mode), deploy a pack. `/automations/catalog` redirects here |
| Policies | `/automations` | Run Audit / Enforce, enable, disable, delete |
| Runs | `/automations/runs` | See what each run found or changed, before/after state, roll back |

---

## 1. Connect the automation app

Automations use a **separate, read-write Entra app** (`microsoft365-automation`). The reporting app
stays read-only and is never used for changes.

1. Open **Settings → Integrations** and find the **Microsoft 365 Automation** card (below the reporting app).
2. Use **Quick Setup** (Device Code) or **Advanced** (manual app id / certificate / secret).
3. Choose the scope mode: **All automations** or **Active policies only**. The permission list is
   built from each automation's `requiredPermissions`.
4. Re-run the grant whenever a new automation (or a new permission such as `Group.Create`) is
   added — the card lists missing scopes.

## 2. Add a policy

From **Catalog**, click **Add policy** (or **Deploy (Audit)** on a pack). Fill in the parameters.

- **One-click group:** parameters that need a security group show
  **Create group "Argus - …"**. Argus creates a cloud, assigned-membership security group with that
  name — or reuses it if it already exists — and fills in its id.
- Every new policy starts in **Audit**.

## 3. Audit vs Enforce

| Mode | What happens |
|------|--------------|
| **Audit** | Read-only what-if. `plan()` runs behind a guard that rejects any POST/PATCH/DELETE. The run lists what *would* change. |
| **Enforce** | Applies the planned changes, at most **Max changes per run** (circuit breaker). Each change stores before/after JSON and, when reversible, a rollback payload. The button needs a second click to confirm. |

Recommended rollout: run Audit, read the run in **Runs**, add exclusions, then Enforce.

## 4. Roll back

In **Runs**, expand a run and click **Roll back** on an applied change. Argus replays the stored
rollback request (re-enable a user, restore from the recycle bin, re-add / remove a group member,
restore a policy state, re-assign licenses). Intune retire and expired-secret removal have no
rollback payload and cannot be undone.

## 5. Catalog

| Automation | Category | Risk | Changes | Rollback |
|------------|----------|------|---------|----------|
| Break-Glass CA Exclusion Guardrail | conditional-access | high | Adds break-glass users/groups to CA policy exclusions | Restore previous exclusions |
| CA Baseline & Trusted IP Guardrail | conditional-access | high | Re-enables mandatory CA policies, resets trusted named location CIDRs | Previous state |
| High-Risk User Auto-Containment | security | high | Blocks sign-in (and revokes sessions) for uncontained high-risk users | Re-enable sign-in |
| External Mailbox Forwarding Remediation | security | medium | Disables inbox rules forwarding outside verified domains | Re-enable rule |
| Compromised Workload Identity Containment | security | high | Disables risky service principals | Re-enable |
| Unverified OAuth2 Consent Revocation | security | medium | Deletes high-risk delegated grants | Re-create grant |
| Privileged Tier-0 Role Drift Guard | governance | high | Removes unapproved role assignments (never the last Global Admin) | Re-assign |
| Tenant Authorization & Consent Hardening | identity | high | Hardens `authorizationPolicy` settings | Previous settings |
| Disabled User License & Group Reclaim | licensing | medium | Removes direct licenses / cloud groups from disabled users | Re-assign licenses |
| Dormant Premium License Reclaim | licensing | medium | Removes add-on SKUs from inactive users | Re-assign |
| Stale & Unredeemed B2B Guest Cleanup | identity | medium | Disables stale / unredeemed guests | Re-enable |
| Expired App Secret Cleanup | governance | low | Removes expired client secrets | None (secret is gone) |
| Ownerless M365 Group Custodian | governance | low | Assigns a fallback owner | Remove owner |
| Stale Device Lifecycle Hygiene | devices | medium | Retires stale Intune devices, soft-deletes stale Entra devices | Entra restore only |
| Leaver Offboarding | identity | high | Disables + revokes sessions once `employeeLeaveDateTime` passed | Re-enable |
| Inactive Member Account Disable | identity | high | Disables members with no sign-in for N days (default 90) | Re-enable |
| Disabled Account Cleanup | identity | high | Soft-deletes disabled accounts idle N days (default 180) | Restore (30 days) |
| Joiner / Mover Group Sync | governance | medium | Adds / removes members per `attribute=value => groupId` rules | Inverse membership |
| End-of-Support OS Device Lifecycle | devices | low | Keeps devices below the per-platform minimum OS in a group; removes upgraded ones | Inverse membership |

**Packs:** Zero-Trust & Lockout Guardrails · Active Threat Containment · Lifecycle Hygiene & FinOps
Reclaim · User & Device Lifecycle.

## 6. Safety guards

- `plan()` is read-only (engine guard) — Audit can never change the tenant.
- New policies and pack deployments default to Audit.
- **Max changes per run** halts Enforce runs that would change too much.
- Exclusion lists on every user-affecting automation (put break-glass and service accounts there).
- AD-synced users and dynamic / on-prem groups are skipped (they cannot be changed from the cloud).
- One run per policy at a time (`409` on overlap).

## 7. Verification

`tests/automations-smoke.test.ts` runs every automation Audit → Enforce → Rollback through the real
engine against a fake unhealthy tenant; `bun test tests/` must stay green when adding automations.
