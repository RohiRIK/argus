# Report Catalog — Reference & Review Status

Every built-in report, what it answers, and how far it's been reviewed end-to-end
against a live tenant. Updated as we work through them.

**Status legend**
- ✅ **Reviewed & polished** — verified live, columns/recommendations are good, emailed + confirmed.
- ✓ **Probed OK** — runs live with real data and sensible columns; not yet deeply reworked.
- ⚠ **Needs fix** — blocked or has a known issue (see notes).
- ◻ **Not yet reviewed** — registered and runs, but not individually audited.

> Cross-cutting note: the 6 CSV usage reports (Teams, Mailbox, M365 Groups, OneDrive,
> SharePoint, Active Users) only show **real names** when tenant report-name concealment
> is OFF (M365 Admin → Settings → Org settings → Reports). See the catalog heads-up.

---

## Identity

| Report | id | What it answers | Status | Notes |
|---|---|---|---|---|
| Daily Sign-in Anomalies | `sign-in-anomalies` | Failed sign-ins grouped by user + app, with decoded reason, app name/ID, attempt count, last-seen date, status, and a recommendation | ✅ | **Production ready.** Decodes AADSTS error codes to plain English (11 mapped), strips Microsoft placeholder garble, aggregates duplicate failures, surfaces the offending app. |
| Risky Users Report | `risky-users` | Users flagged by Identity Protection | ◻ | 0 in demo tenant. |
| MFA Registration Status | `mfa-registration` | Users not MFA-capable | ✓ | Real UPNs + capable flag. |
| Inactive Guest Users | `inactive-guest-users` | External guests inactive 90+ days | ◻ | 0 in demo tenant. |
| License Reclamation | `dormant-licensed-users` | Reclaimable licenses: dormant / never / disabled-but-licensed (zombie), with a plain-English recommendation per user | ✅ | Reframed from "Email Activity". Per-job threshold (Advanced → dormant days, default 30). |

## Security

| Report | id | What it answers | Status | Notes |
|---|---|---|---|---|
| Security Alerts Digest | `security-alerts-digest` | Active security alerts by severity | ⚠ | 403 — app missing permission on `/security/alerts_v2` (`SecurityAlert.Read.All`). |
| DLP Alerts | `dlp-alerts` | Data-loss-prevention alerts | ⚠ | 403 — same `/security/alerts_v2` permission gap. |
| Conditional Access Failures | `conditional-access-failures` | Sign-ins blocked by CA policy | ◻ | 0 in demo tenant. |
| Secure Score Trend | `secure-score` | Microsoft Secure Score control states | ✓ | Probes OK. |
| Risky Service Principals | `risky-service-principals` | Service principals flagged risky | ◻ | 0 in demo tenant. |
| User Risk Detections | `risk-detections` | Identity Protection risk detections | ◻ | 28 rows — columns not yet audited. |
| Service Principal Risk Detections | `sp-risk-detections` | Risk detections for service principals | ◻ | 0 in demo tenant. |
| Service Principal Sign-Ins | `sp-sign-ins` | App/service-principal sign-in activity | ◻ | 141 rows — columns not yet audited. |

## Infrastructure

| Report | id | What it answers | Status | Notes |
|---|---|---|---|---|
| License Utilization | `license-utilization` | Assigned vs available seats per SKU | ◻ | Uses `/subscribedSkus`. Friendly SKU names TBD. |
| App Secrets / Certificates Expiry | `app-secrets-expiry` | App credentials expiring soon | ✓ | Real app + credential + daysLeft. |
| Device Compliance (Intune) | `device-compliance` | Non-compliant managed devices | ◻ | 0 in demo tenant. |
| Audit Log Summary | `audit-log-summary` | Recent directory audit activity | ✓ | activity / category / by / result. |
| Provisioning Log Summary | `provisioning-summary` | App provisioning events | ◻ | 0 in demo tenant. |
| Teams User Activity | `teams-user-activity` | Inactive licensed Teams users | ◻ | CSV — needs concealment off; column review pending. |
| Mailbox Quota Status | `mailbox-quota` | Mailboxes near quota | ◻ | CSV — 0 near quota in demo. |
| M365 Groups Activity | `m365-groups-activity` | Stale / externally-shared groups | ◻ | CSV — review pending. |
| OneDrive Storage & Quota | `onedrive-usage` | OneDrive accounts near allocation | ◻ | CSV — review pending. |
| SharePoint Site Usage | `sharepoint-site-usage` | Inactive SharePoint sites | ✅ | Fixed `col()` fallback + concealment; real site names; emailed + confirmed. |
| Active Users per Service | `active-users-counts` | Active vs inactive counts per service | ◻ | CSV — review pending. |
| Custom Security Attribute Audit | `custom-attr-audits` | Custom security attribute assignments | ◻ | 0 in demo tenant. |

## Custom

| Report | id | What it answers | Status | Notes |
|---|---|---|---|---|
| Manual Graph Query | `manual-graph-query` | Ad-hoc Graph endpoint query | ⚠ | Requires an `endpoint` param (by design — parameterized). |

---

## Review approach (per report)
1. Probe live: `bun scripts/probe-report-dump.ts <id>` — inspect real columns + sample rows.
2. Fix field mappings / reframe purpose / add recommendations as needed.
3. Send to verify: `bun scripts/send-report.ts <id> <email>`.
4. Confirm, commit, update this table.
