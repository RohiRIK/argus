# New Report Candidates — Microsoft Graph API Gap Analysis

> The Argus catalog ships **15 built-in reports** — the original 12 plus the 3 Tier-1 candidates below (`secure-score`, `provisioning-summary`, `risky-service-principals`), now implemented in `src/services/reports/catalog-new.ts`. This document maps the remaining Microsoft Graph v1.0 surface that is not yet covered, prioritises candidates by security/operational value and implementation effort, and provides a blueprint for adding each one.
>
> **Status:** ✅ Tier 1 (JSON drop-ins) shipped. ⏳ Tier 2/3 (CSV usage reports) pending — they require a new `transport.getCsv()` that follows the 302→CSV redirect (see Pattern B).

---

## Existing Reports (Baseline)

| # | ID | Category | Graph Endpoint | Permission |
|---|----|----------|---------------|------------|
| 1 | `sign-in-anomalies` | identity | `GET /auditLogs/signIns` | `AuditLog.Read.All` |
| 2 | `risky-users` | identity | `GET /identityProtection/riskyUsers` | `IdentityRiskyUser.Read.All` |
| 3 | `mfa-registration` | identity | `GET /reports/authenticationMethods/userRegistrationDetails` | `AuditLog.Read.All` + `UserAuthenticationMethod.Read.All` |
| 4 | `inactive-guest-users` | identity | `GET /users?$filter=userType eq 'Guest'` | `User.Read.All` + `AuditLog.Read.All` |
| 5 | `security-alerts-digest` | security | `GET /security/alerts_v2` | `SecurityEvents.Read.All` |
| 6 | `dlp-alerts` | security | `GET /security/alerts_v2?$filter=category eq 'DataLossPrevention'` | `SecurityEvents.Read.All` |
| 7 | `conditional-access-failures` | security | `GET /auditLogs/signIns?$filter=conditionalAccessStatus eq 'failure'` | `AuditLog.Read.All` |
| 8 | `license-utilization` | infrastructure | `GET /subscribedSkus` | `Organization.Read.All` |
| 9 | `app-secrets-expiry` | infrastructure | `GET /applications` | `Application.Read.All` |
| 10 | `device-compliance` | infrastructure | `GET /deviceManagement/managedDevices` | `DeviceManagementManagedDevices.Read.All` |
| 11 | `audit-log-summary` | infrastructure | `GET /auditLogs/directoryAudits` | `AuditLog.Read.All` |
| 12 | `manual-graph-query` | custom | (user-specified) | depends on endpoint |

**Graph permissions already granted** by the default integration: `AuditLog.Read.All`, `IdentityRiskyUser.Read.All`, `UserAuthenticationMethod.Read.All`, `Organization.Read.All`, `Application.Read.All`, `SecurityEvents.Read.All`, `DeviceManagementManagedDevices.Read.All`, `User.Read.All`.

---

## Gap Analysis

Three distinct categories of v1.0 Graph endpoints are not covered:

### A. JSON REST Endpoints (drop-in, same pattern as existing)

These return JSON collections — the existing `GraphTransport.get()` handles them directly. Lowest implementation effort (~60 lines per report).

| Endpoint | Permission | Data |
|----------|-----------|------|
| `GET /identityProtection/riskyServicePrincipals` | `IdentityRiskyServicePrincipal.Read.All` | Service principals flagged as risky by Identity Protection |
| `GET /identityProtection/servicePrincipalRiskDetections` | `IdentityRiskyServicePrincipal.Read.All` | Individual risk detections for service principals (type, level, state) |
| `GET /identityProtection/riskDetections` | `IdentityRiskEvent.Read.All` | All user risk detection events (vs. the aggregated `riskyUsers` view) |
| `GET /security/secureScores` | `SecurityEvents.Read.All` ✅ **already granted** | Tenant Secure Score, per-control scores, peer benchmarks |
| `GET /auditLogs/provisioning` | `AuditLog.Read.All` + `Directory.Read.All` | HR provisioning (Workday → Entra ID), app SCIM sync events |
| `GET /auditLogs/customSecurityAttributeAudits` | `AuditLog.Read.All` ✅ **already granted** | Audit log of custom security attribute changes |

### B. CSV Usage Reports (302 → CSV)

These return a 302 redirect to a pre-authenticated CSV download. Argus would need a new transport path (`transport.getCsv()`) that follows redirects and parses CSV rows. All require `Reports.Read.All`.

| Endpoint | What It Returns | Admin Signal |
|----------|----------------|--------------|
| `GET /reports/getTeamsUserActivityUserDetail(period='D7')` | Per-user: chat messages, calls, meetings, last activity date | Teams adoption, unused licensed users |
| `GET /reports/getTeamsDeviceUsageUserDetail(period='D7')` | Per-user: device type (Windows, phone, web), last activity | Device adoption, unmanaged access |
| `GET /reports/getTeamsTeamActivityDetail(period='D7')` | Per-team: active users, channels, reactions, guests, messages | Stale teams, governance |
| `GET /reports/getSharePointSiteUsageDetail(period='D7')` | Per-site: files, pages, storage used/allocated, last activity | Storage management, stale sites |
| `GET /reports/getSharePointActivityUserDetail(period='D7')` | Per-user: files viewed, synced, shared internally/externally | External sharing audit |
| `GET /reports/getOneDriveUsageAccountDetail(period='D7')` | Per-account: file count, storage used/allocated, last activity | Quota monitoring, stale accounts |
| `GET /reports/getOneDriveActivityUserDetail(period='D7')` | Per-user: files viewed, edited, synced, shared | Collaboration patterns |
| `GET /reports/getMailboxUsageDetail(period='D7')` | Per-mailbox: item count, storage, quota thresholds, archive status | Quota management, proactive alerts |
| `GET /reports/getOffice365GroupsActivityDetail(period='D7')` | Per-group: email, SP files, Yammer, member/guest count, storage | Group lifecycle, external member sprawl |
| `GET /reports/getOffice365ServicesUserCounts(period='D7')` | Per-service: active vs inactive user counts | License utilization per workload |
| `GET /reports/getEmailActivityUserDetail(period='D7')` | Per-user: emails sent, received, read | Communication patterns |

### C. Filtered / Beta Endpoints

| Endpoint | Notes |
|----------|-------|
| `GET /auditLogs/signIns?$filter=signInEventTypes/any(t:t eq 'servicePrincipal')` | Relies on beta filter parameter on a v1.0 endpoint. Would give non-human identity sign-in monitoring. |

---

## Prioritised Recommendations

### Tier 1 — High Value, Low Effort (JSON, minimal/no new permissions)

#### 1. Secure Score Trend

| Field | Value |
|-------|-------|
| **Endpoint** | `GET /security/secureScores` |
| **Permission** | `SecurityEvents.Read.All` ✅ already granted |
| **Effort** | ~60 lines — drop-in `ReportDefinition` |
| **Category** | `security` |
| **Baseline support** | Yes |
| **Why** | Secure Score is the single most important tenant security metric. It tracks posture across Identity, Data, Device, Infrastructure categories with peer benchmarking. No new permissions required — the only zero-overhead addition. |

**Signal**: Score drop, new control opportunities, tracking week-over-week improvement.

---

#### 2. Provisioning Log Summary

| Field | Value |
|-------|-------|
| **Endpoint** | `GET /auditLogs/provisioning` |
| **Permission** | `AuditLog.Read.All` ✅ already granted + `Directory.Read.All` |
| **Effort** | ~60 lines — drop-in `ReportDefinition` |
| **Category** | `infrastructure` |
| **Baseline support** | Yes |
| **Why** | Provisioning pipelines (HR → Entra ID, SCIM syncs) fail silently. This report surfaces sync failures, skipped users, and timing anomalies before they cascade into access problems. Complements `audit-log-summary` but scoped to provisioning. |

**Signal**: Failed syncs, unusual number of creates/deletes, duration anomalies.

---

#### 3. Risky Service Principals

| Field | Value |
|-------|-------|
| **Endpoint** | `GET /identityProtection/riskyServicePrincipals` |
| **Permission** | `IdentityRiskyServicePrincipal.Read.All` (new, mirrors existing `IdentityRiskyUser.Read.All`) |
| **Effort** | ~60 lines — drop-in `ReportDefinition` |
| **Category** | `security` |
| **Baseline support** | Yes |
| **Why** | Mirrors the existing `risky-users` report but for non-human identities (apps, managed identities). Workload identity compromise is Microsoft's #1 emerging attack vector. Requires a Workload Identities Premium license. |

**Signal**: Service principals moving to `atRisk` or `confirmedCompromised` state.

---

### Tier 2 — High Value, Medium Effort (CSV-based)

These require new transport infrastructure: a `transport.getCsv()` method that follows 302 redirects and returns parsed rows. Once built, all CSV reports cost ~80 lines each.

#### 4. Teams User Activity

| Field | Value |
|-------|-------|
| **Endpoint** | `GET /reports/getTeamsUserActivityUserDetail(period='D7')` |
| **Permission** | `Reports.Read.All` (new) |
| **Effort** | ~80 lines + CSV transport |
| **Category** | `infrastructure` (or new `collaboration`) |
| **Why** | Teams adoption is the #1 business question for M365 admins. Per-user message/call/meeting counts, last activity date. Spot inactive licensed users and reclaim licenses. |

#### 5. Mailbox Quota Status

| Field | Value |
|-------|-------|
| **Endpoint** | `GET /reports/getMailboxUsageDetail(period='D7')` |
| **Permission** | `Reports.Read.All` (new) |
| **Effort** | ~80 lines + CSV transport |
| **Category** | `infrastructure` |
| **Why** | Mailboxes approaching prohibit-send quotas cause service disruption. Proactive monitoring prevents blocked email. Includes archive status, deleted item quotas, and per-mailbox storage trends. |

#### 6. M365 Groups Activity / Governance

| Field | Value |
|-------|-------|
| **Endpoint** | `GET /reports/getOffice365GroupsActivityDetail(period='D7')` |
| **Permission** | `Reports.Read.All` (new) |
| **Effort** | ~80 lines + CSV transport |
| **Category** | `infrastructure` |
| **Why** | Groups (and their Teams) proliferate rapidly. This report surfaces stale groups, groups with excessive external members, storage consumption, and activity patterns across email, SharePoint, and Yammer. |

---

### Tier 3 — Specialised / Situational

| Report | Endpoint | When To Add |
|--------|----------|-------------|
| OneDrive Storage & Quota | `GET /reports/getOneDriveUsageAccountDetail(period='D7')` | After CSV transport exists; storage cost management |
| SharePoint Site Usage | `GET /reports/getSharePointSiteUsageDetail(period='D7')` | After CSV transport exists; site sprawl governance |
| Risk Detection Events (User) | `GET /identityProtection/riskDetections` | If admins need per-event granularity beyond `risky-users` |
| Service Principal Sign-Ins | `GET /auditLogs/signIns` with beta filter | When non-human identity monitoring is prioritised |
| Custom Security Attribute Audit | `GET /auditLogs/customSecurityAttributeAudits` | If tenant uses custom security attributes |

---

## Implementation Blueprint

### Pattern A — JSON Report (Tier 1)

```typescript
interface SecureScoreRecord {
  id: string;
  currentScore: number;
  maxScore: number;
  enabledServices: string[];
  averageComparativeScores: { basis: string; averageScore: number }[];
  controlScores: { controlCategory: string; controlName: string; score: number }[];
}

export const secureScoreReport: ReportDefinition<SecureScoreRecord> = {
  id: "secure-score",
  name: "Secure Score Trend",
  category: "security",
  description: "Tenant Secure Score with per-control breakdown and peer benchmarks.",
  requiredPermissions: ["SecurityEvents.Read.All"],
  baselineSupport: true,
  async fetch(transport) {
    return (await transport.get<SecureScoreRecord>("/security/secureScores?$top=1")).value;
  },
  summarize(rows): ReportSummary {
    const latest = rows[0];
    const identityScore = latest?.controlScores?.find(c => c.controlCategory === "Identity");
    const dataScore = latest?.controlScores?.find(c => c.controlCategory === "Data");
    return {
      count: latest ? Math.round(latest.currentScore) : 0,
      variables: {
        currentScore: latest?.currentScore ?? 0,
        maxScore: latest?.maxScore ?? 0,
        pctOfMax: latest?.maxScore ? Math.round((latest.currentScore / latest.maxScore) * 100) : 0,
        identityControls: identityScore?.score ?? 0,
        dataControls: dataScore?.score ?? 0,
        peerAvg: latest?.averageComparativeScores?.find(a => a.basis === "AllTenants")?.averageScore ?? 0,
      },
      rows: (latest?.controlScores ?? []).map(c => ({
        category: c.controlCategory,
        control: c.controlName,
        score: c.score,
      })),
    };
  },
};
```

Registration in `registry.ts`:

```typescript
import { secureScoreReport } from "./catalog-new";
// add to REPORTS map
```

Template seeded automatically by `seed.ts` (it iterates `listReports()`).

### Pattern B — CSV Report (Tier 2)

Add to `GraphTransport` interface:

```typescript
interface GraphTransport {
  get<T>(path: string): Promise<GraphPage<T>>;
  getCsv(path: string): Promise<{ headers: string[]; rows: Record<string, string>[] }>;
  batch?(requests: GraphBatchRequest[]): Promise<GraphBatchResponse[]>;
}
```

Implementation follows the 302 redirect from `client.api(path).get()` then parses the CSV response. The report itself then mirrors Pattern A but calls `transport.getCsv()` instead of `transport.get()`.

---

## Permission Summary

| Permission | Reports That Need It | Already Granted? |
|-----------|---------------------|-----------------|
| `SecurityEvents.Read.All` | Secure Score | ✅ Already granted |
| `IdentityRiskyServicePrincipal.Read.All` | Risky Service Principals, SP Risk Detections | ❌ New |
| `IdentityRiskEvent.Read.All` | Risk Detections (user) | ❌ New |
| `Reports.Read.All` | ALL CSV-based reports (Teams, SPO, OD, Mailbox, Groups, Email, Active Users) | ❌ New |

Adding `Reports.Read.All` unlocks the entire CSV category (~11 reports) in a single permission grant.

---

## Decision Matrix

| If you want… | Add… | Effort |
|-------------|------|--------|
| Maximum security value, zero permission overhead | Secure Score Trend | ~60 min |
| Catch provisioning failures before they cascade | Provisioning Log Summary | ~60 min |
| Cover non-human identity risk | Risky Service Principals | ~60 min + new permission |
| Maximum business visibility (Teams adoption) | Teams User Activity | ~4 hr (incl. CSV transport) |
| Operational reliability (mailbox quotas) | Mailbox Quota Status | ~4 hr (incl. CSV transport) |
| Governance (stale groups, external guest sprawl) | M365 Groups Activity | ~4 hr (incl. CSV transport) |
| All usage reports in one go | Build CSV transport, then add all 11 | ~6 hr total |

