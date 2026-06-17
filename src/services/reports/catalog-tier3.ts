import type { ReportDefinition, ReportSummary } from "./types";

const WEEK_MS = 604_800_000;
const terminalRiskStates = new Set(["remediated", "dismissed", "confirmedSafe"]);

/** Tier-3 JSON drop-in reports (docs/new-reports.md) — same pattern as Tier 1. */

// ── User Risk Detections ─────────────────────────────────────────────────────
interface RiskDetection {
  id: string;
  riskEventType?: string;
  riskLevel?: "low" | "medium" | "high" | "none";
  riskState?: string;
  riskDetail?: string;
  userPrincipalName?: string;
  userDisplayName?: string;
  detectedDateTime?: string;
  lastUpdatedDateTime?: string;
  ipAddress?: string;
  activity?: string;
  additionalInfo?: string;
  currentRiskLevel?: "low" | "medium" | "high" | "none";
  currentRiskState?: string;
  currentRiskLastUpdatedDateTime?: string;
}

interface RiskyUserState {
  id?: string;
  userPrincipalName?: string;
  riskLevel?: "low" | "medium" | "high" | "none";
  riskState?: string;
  riskLastUpdatedDateTime?: string;
}

function isCurrentRiskActive(row: RiskDetection): boolean {
  return row.currentRiskState === "atRisk" || row.currentRiskState === "confirmedCompromised" || row.riskState === "atRisk" || row.riskState === "confirmedCompromised";
}

function isRemediatedThisWeek(row: RiskDetection): boolean {
  const state = row.currentRiskState ?? row.riskState;
  if (!terminalRiskStates.has(state ?? "")) return false;
  const updated = row.lastUpdatedDateTime ?? row.currentRiskLastUpdatedDateTime ?? row.detectedDateTime;
  if (!updated) return true;
  return new Date(updated).getTime() >= Date.now() - WEEK_MS;
}

function isRecent(value?: string): boolean {
  if (!value) return true;
  return new Date(value).getTime() >= Date.now() - WEEK_MS;
}

function riskReason(row: RiskDetection): string {
  const parts: string[] = [];
  if (row.riskEventType && row.riskEventType !== "current-risky-user") parts.push(row.riskEventType);
  if (row.riskDetail && row.riskDetail !== "none") parts.push(row.riskDetail);
  if (!parts.length && row.currentRiskState) parts.push(row.currentRiskState);
  return parts.join(" · ") || "unknown";
}

function remediationText(row: RiskDetection): string {
  const state = row.currentRiskState ?? row.riskState ?? "";
  if (isCurrentRiskActive(row)) return "Pending: verify credential reset, revoke sessions, then dismiss if false positive.";
  if (state === "remediated") return `Complete: ${row.riskDetail || "remediated"}`;
  if (state === "dismissed") return `Dismissed: ${row.riskDetail || "dismissed"}`;
  if (state === "confirmedSafe") return `Confirmed safe: ${row.riskDetail || "confirmed safe"}`;
  return "No current remediation state.";
}

function shortDateTime(value?: string): string {
  if (!value) return "—";
  return value.replace("T", " ").replace(/\.\d{3}Z$/, "Z");
}

export const riskDetectionsReport: ReportDefinition<RiskDetection> = {
  id: "risk-detections",
  name: "User Risk Detections",
  category: "security",
  description: "Individual Identity Protection risk detection events (per-event granularity).",
  requiredPermissions: ["IdentityRiskEvent.Read.All", "IdentityRiskyUser.Read.All"],
  baselineSupport: true,
  async fetch(transport) {
    const since = new Date(Date.now() - WEEK_MS).toISOString();
    const [detections, users] = await Promise.all([
      (
        await transport.get<RiskDetection>(
          // Identity Protection endpoints cap $top at 500 (999 → 400); the transport pages the rest via @odata.nextLink.
          `/identityProtection/riskDetections?$top=500&$filter=detectedDateTime ge ${since}&$select=id,riskEventType,riskLevel,riskState,riskDetail,userPrincipalName,userDisplayName,detectedDateTime,lastUpdatedDateTime,ipAddress,activity,additionalInfo`,
        )
      ).value,
      (
        await transport.get<RiskyUserState>(
          "/identityProtection/riskyUsers?$top=500&$select=id,userPrincipalName,riskLevel,riskState,riskLastUpdatedDateTime",
        )
      ).value,
    ]);
    const currentByUser = new Map(users.map((u) => [(u.userPrincipalName ?? "").toLowerCase(), u]));
    const seenUsers = new Set<string>();
    const enriched = detections.map((d) => {
      const key = (d.userPrincipalName ?? "").toLowerCase();
      seenUsers.add(key);
      const current = currentByUser.get(key);
      return {
        ...d,
        currentRiskLevel: current?.riskLevel ?? "none",
        currentRiskState: current?.riskState ?? "notInRiskyUsers",
        currentRiskLastUpdatedDateTime: current?.riskLastUpdatedDateTime,
      };
    });
    const activeWithoutDetection = users
      .filter((u) => u.riskState === "atRisk" || u.riskState === "confirmedCompromised")
      .filter((u) => isRecent(u.riskLastUpdatedDateTime))
      .filter((u) => !seenUsers.has((u.userPrincipalName ?? "").toLowerCase()))
      .map((u) => ({
        id: `current-${u.id ?? u.userPrincipalName ?? crypto.randomUUID()}`,
        riskEventType: "current-risky-user",
        riskLevel: u.riskLevel ?? "none",
        riskState: u.riskState,
        riskDetail: `Current Identity Protection state: ${u.riskState}`,
        userPrincipalName: u.userPrincipalName,
        detectedDateTime: u.riskLastUpdatedDateTime,
        lastUpdatedDateTime: u.riskLastUpdatedDateTime,
        currentRiskLevel: u.riskLevel ?? "none",
        currentRiskState: u.riskState,
        currentRiskLastUpdatedDateTime: u.riskLastUpdatedDateTime,
      }));
    return [...enriched, ...activeWithoutDetection];
  },
  summarize(rows): ReportSummary {
    const relevant = rows.filter((r) => isCurrentRiskActive(r) || isRemediatedThisWeek(r));
    const high = rows.filter((r) => r.riskLevel === "high");
    const activeRisk = rows.filter(isCurrentRiskActive);
    const remediatedThisWeek = rows.filter(isRemediatedThisWeek);
    const byType = relevant.reduce<Record<string, number>>((acc, r) => {
      const k = r.riskEventType ?? "unknown";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    return {
      count: relevant.length,
      variables: {
        totalDetections: rows.length,
        highRisk: high.length,
        activeRisk: activeRisk.length,
        remediatedThisWeek: remediatedThisWeek.length,
        types: Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(", "),
      },
      rows: relevant.slice(0, 50).map((r) => ({
        user: r.userPrincipalName ?? "—",
        type: r.riskEventType ?? "—",
        level: r.riskLevel ?? "none",
        why: riskReason(r),
        currentState: r.currentRiskState ?? "—",
        detected: shortDate(r.detectedDateTime),
        remediatedAt: shortDateTime(r.lastUpdatedDateTime ?? r.currentRiskLastUpdatedDateTime),
        remediation: remediationText(r),
        ipAddress: r.ipAddress ?? "—",
      })),
    };
  },
};

// ── Service Principal Risk Detections ────────────────────────────────────────
interface SpRiskDetection {
  id: string;
  riskEventType?: string;
  riskLevel?: "low" | "medium" | "high" | "none" | "hidden";
  riskState?: string;
  riskDetail?: string;
  servicePrincipalDisplayName?: string;
  servicePrincipalId?: string;
  appId?: string;
  detectedDateTime?: string;
  lastUpdatedDateTime?: string;
  ipAddress?: string;
  activity?: string;
  additionalInfo?: string;
  keyIds?: string[];
  currentRiskLevel?: "low" | "medium" | "high" | "none" | "hidden";
  currentRiskState?: string;
  currentRiskLastUpdatedDateTime?: string;
}

interface RiskyServicePrincipalState {
  id?: string;
  displayName?: string;
  appId?: string;
  servicePrincipalType?: string;
  riskLevel?: "low" | "medium" | "high" | "none" | "hidden";
  riskState?: string;
  riskDetail?: string;
  riskLastUpdatedDateTime?: string;
  isEnabled?: boolean;
  isProcessing?: boolean;
}

function isSpRiskActive(row: SpRiskDetection): boolean {
  return row.currentRiskState === "atRisk" || row.currentRiskState === "confirmedCompromised" || row.riskState === "atRisk" || row.riskState === "confirmedCompromised";
}

function isSpRemediatedThisWeek(row: SpRiskDetection): boolean {
  const state = row.currentRiskState ?? row.riskState;
  if (!terminalRiskStates.has(state ?? "")) return false;
  const updated = row.lastUpdatedDateTime ?? row.currentRiskLastUpdatedDateTime ?? row.detectedDateTime;
  if (!updated) return true;
  return new Date(updated).getTime() >= Date.now() - WEEK_MS;
}

function spRiskReason(row: SpRiskDetection): string {
  const parts: string[] = [];
  if (row.riskEventType && row.riskEventType !== "current-risky-service-principal") parts.push(row.riskEventType);
  if (row.riskDetail && row.riskDetail !== "none") parts.push(row.riskDetail);
  if (!parts.length && row.currentRiskState) parts.push(row.currentRiskState);
  return parts.join(" · ") || "unknown";
}

function spRemediationText(row: SpRiskDetection): string {
  const state = row.currentRiskState ?? row.riskState ?? "";
  if (isSpRiskActive(row)) return "Pending: review credential/key exposure, rotate secrets if needed, then dismiss if false positive.";
  if (state === "remediated") return `Complete: ${row.riskDetail || "remediated"}`;
  if (state === "dismissed") return `Dismissed: ${row.riskDetail || "dismissed"}`;
  if (state === "confirmedSafe") return `Confirmed safe: ${row.riskDetail || "confirmed safe"}`;
  return "No current remediation state.";
}

export const spRiskDetectionsReport: ReportDefinition<SpRiskDetection> = {
  id: "sp-risk-detections",
  name: "Service Principal Risk Detections",
  category: "security",
  description: "Current and last-week risk detections for workload identities (apps, managed identities).",
  requiredPermissions: ["IdentityRiskyServicePrincipal.Read.All"],
  baselineSupport: true,
  async fetch(transport) {
    const since = new Date(Date.now() - WEEK_MS).toISOString();
    const [detections, current] = await Promise.all([
      (
        await transport.get<SpRiskDetection>(
          "/identityProtection/servicePrincipalRiskDetections?$top=500&$filter=detectedDateTime ge " +
            `${since}&$select=id,riskEventType,riskLevel,riskState,riskDetail,servicePrincipalDisplayName,servicePrincipalId,appId,detectedDateTime,lastUpdatedDateTime,ipAddress,activity,additionalInfo,keyIds`,
        )
      ).value,
      (
        await transport.get<RiskyServicePrincipalState>(
          "/identityProtection/riskyServicePrincipals?$top=500&$select=id,displayName,appId,servicePrincipalType,riskLevel,riskState,riskDetail,riskLastUpdatedDateTime,isEnabled,isProcessing",
        )
      ).value,
    ]);
    const currentBySpId = new Map(current.map((s) => [(s.id ?? "").toLowerCase(), s]));
    const currentByAppId = new Map(current.map((s) => [(s.appId ?? "").toLowerCase(), s]));
    const seen = new Set<string>();
    const enriched = detections.map((d) => {
      const key = (d.servicePrincipalId ?? "").toLowerCase();
      const appIdKey = (d.appId ?? "").toLowerCase();
      seen.add(key || appIdKey);
      const sp = currentBySpId.get(key) ?? (appIdKey ? currentByAppId.get(appIdKey) : undefined);
      return {
        ...d,
        currentRiskLevel: sp?.riskLevel ?? "none",
        currentRiskState: sp?.riskState ?? "notInRiskyServicePrincipals",
        currentRiskLastUpdatedDateTime: sp?.riskLastUpdatedDateTime,
      };
    });
    const activeWithoutDetection = current
      .filter((s) => s.riskState === "atRisk" || s.riskState === "confirmedCompromised")
      .filter((s) => isRecent(s.riskLastUpdatedDateTime))
      .filter((s) => !seen.has((s.id ?? "").toLowerCase()) && !seen.has((s.appId ?? "").toLowerCase()))
      .map((s) => ({
        id: `current-${s.id ?? s.appId ?? crypto.randomUUID()}`,
        riskEventType: "current-risky-service-principal",
        riskLevel: s.riskLevel ?? "none",
        riskState: s.riskState,
        riskDetail: `Current Identity Protection state: ${s.riskState}`,
        servicePrincipalDisplayName: s.displayName,
        servicePrincipalId: s.id,
        appId: s.appId,
        detectedDateTime: s.riskLastUpdatedDateTime,
        lastUpdatedDateTime: s.riskLastUpdatedDateTime,
        currentRiskLevel: s.riskLevel ?? "none",
        currentRiskState: s.riskState,
        currentRiskLastUpdatedDateTime: s.riskLastUpdatedDateTime,
      }));
    return [...enriched, ...activeWithoutDetection];
  },
  summarize(rows): ReportSummary {
    const relevant = rows.filter((r) => isSpRiskActive(r) || isSpRemediatedThisWeek(r));
    const high = rows.filter((r) => r.riskLevel === "high");
    const activeRisk = rows.filter(isSpRiskActive);
    const remediatedThisWeek = rows.filter(isSpRemediatedThisWeek);
    const byType = relevant.reduce<Record<string, number>>((acc, r) => {
      const k = r.riskEventType ?? "unknown";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    return {
      count: relevant.length,
      variables: {
        totalDetections: rows.length,
        highRisk: high.length,
        activeRisk: activeRisk.length,
        remediatedThisWeek: remediatedThisWeek.length,
        types: Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(", "),
      },
      rows: relevant.slice(0, 50).map((r) => ({
        servicePrincipal: r.servicePrincipalDisplayName ?? "—",
        appId: r.appId ?? "—",
        level: r.riskLevel ?? "none",
        state: r.currentRiskState ?? r.riskState ?? "—",
        why: spRiskReason(r),
        detected: shortDate(r.detectedDateTime),
        remediatedAt: shortDateTime(r.lastUpdatedDateTime ?? r.currentRiskLastUpdatedDateTime),
        remediation: spRemediationText(r),
        servicePrincipalId: r.servicePrincipalId ?? "—",
        ipAddress: r.ipAddress ?? "—",
      })),
    };
  },
};

// ── Custom Security Attribute Audit ──────────────────────────────────────────
interface CustomAttrAudit {
  id: string;
  activityDisplayName?: string;
  result?: string;
  initiatedBy?: { user?: { userPrincipalName?: string } };
  activityDateTime?: string;
}

export const customAttrAuditsReport: ReportDefinition<CustomAttrAudit> = {
  id: "custom-attr-audits",
  name: "Custom Security Attribute Audit",
  category: "infrastructure",
  description: "Audit log of custom security attribute definition and assignment changes.",
  // customSecurityAttributeAudits (beta) needs its own scope, not the generic AuditLog.Read.All.
  requiredPermissions: ["CustomSecAttributeAuditLogs.Read.All"],
  baselineSupport: true,
  async fetch(transport) {
    return (
      await transport.get<CustomAttrAudit>(
        // customSecurityAttributeAudits is beta-only and rejects $select; the transport routes /beta/.
        "/beta/auditLogs/customSecurityAttributeAudits?$top=500",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const failures = rows.filter((r) => r.result === "failure");
    return {
      count: rows.length,
      variables: { totalChanges: rows.length, failures: failures.length },
      rows: rows.slice(0, 50).map((r) => ({
        activity: r.activityDisplayName ?? "—",
        by: r.initiatedBy?.user?.userPrincipalName ?? "system",
        result: r.result ?? "—",
      })),
    };
  },
};

// ── Service Principal Sign-Ins (beta filter on a v1.0 endpoint) ───────────────
function shortDate(value?: string): string {
  return value ? value.slice(0, 10) : "—";
}
function failureReason(status?: { errorCode?: number; failureReason?: string }): string {
  if (!status || status.errorCode === 0) return "";
  return status.failureReason ?? "failed";
}
interface SpSignIn {
  id: string;
  appDisplayName?: string;
  servicePrincipalId?: string;
  ipAddress?: string;
  status?: { errorCode?: number; failureReason?: string };
  createdDateTime?: string;
}

export const spSignInsReport: ReportDefinition<SpSignIn> = {
  id: "sp-sign-ins",
  name: "Service Principal Sign-Ins",
  category: "security",
  description: "Non-human identity sign-ins (best-effort; the filter may be unsupported on some tenants).",
  requiredPermissions: ["AuditLog.Read.All"],
  baselineSupport: true,
  async fetch(transport) {
    return (
      await transport.get<SpSignIn>(
        // The signInEventTypes filter is beta-only; the transport routes /beta/.
        "/beta/auditLogs/signIns?$top=500&$filter=signInEventTypes/any(t:t eq 'servicePrincipal')" +
          "&$select=id,appDisplayName,servicePrincipalId,ipAddress,status,createdDateTime",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const failed = rows.filter((r) => (r.status?.errorCode ?? 0) !== 0);
    const apps = new Set(rows.map((r) => r.appDisplayName).filter(Boolean));
    const failedApps = new Set(failed.map((r) => r.appDisplayName).filter(Boolean));
    return {
      count: rows.length,
      variables: { totalSignIns: rows.length, failed: failed.length, distinctApps: apps.size, failedApps: failedApps.size },
      rows: rows.slice(0, 50).map((r) => ({
        app: r.appDisplayName ?? "—",
        servicePrincipalId: r.servicePrincipalId ?? "—",
        ipAddress: r.ipAddress ?? "—",
        created: shortDate(r.createdDateTime),
        result: (r.status?.errorCode ?? 0) === 0 ? "success" : "failed",
        failureReason: failureReason(r.status),
      })),
    };
  },
};

export const tier3Reports = [
  riskDetectionsReport,
  spRiskDetectionsReport,
  customAttrAuditsReport,
  spSignInsReport,
];
