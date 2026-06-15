import type { ReportDefinition, ReportSummary } from "./types";

/** Tier-3 JSON drop-in reports (docs/new-reports.md) — same pattern as Tier 1. */

// ── User Risk Detections ─────────────────────────────────────────────────────
interface RiskDetection {
  id: string;
  riskEventType?: string;
  riskLevel?: "low" | "medium" | "high" | "none";
  riskState?: string;
  userPrincipalName?: string;
  detectedDateTime?: string;
}

export const riskDetectionsReport: ReportDefinition<RiskDetection> = {
  id: "risk-detections",
  name: "User Risk Detections",
  category: "security",
  description: "Individual Identity Protection risk detection events (per-event granularity).",
  requiredPermissions: ["IdentityRiskEvent.Read.All"],
  baselineSupport: true,
  async fetch(transport) {
    return (
      await transport.get<RiskDetection>(
        // Identity Protection endpoints cap $top at 500 (999 → 400); the transport pages the rest via @odata.nextLink.
        "/identityProtection/riskDetections?$top=500&$select=id,riskEventType,riskLevel,riskState,userPrincipalName,detectedDateTime",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const high = rows.filter((r) => r.riskLevel === "high");
    const byType = rows.reduce<Record<string, number>>((acc, r) => {
      const k = r.riskEventType ?? "unknown";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    return {
      count: rows.length,
      variables: {
        totalDetections: rows.length,
        highRisk: high.length,
        types: Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(", "),
      },
      rows: rows.slice(0, 50).map((r) => ({
        user: r.userPrincipalName ?? "—",
        type: r.riskEventType ?? "—",
        level: r.riskLevel ?? "none",
        state: r.riskState ?? "—",
      })),
    };
  },
};

// ── Service Principal Risk Detections ────────────────────────────────────────
interface SpRiskDetection {
  id: string;
  riskEventType?: string;
  riskLevel?: "low" | "medium" | "high" | "none";
  riskState?: string;
  servicePrincipalDisplayName?: string;
  detectedDateTime?: string;
}

export const spRiskDetectionsReport: ReportDefinition<SpRiskDetection> = {
  id: "sp-risk-detections",
  name: "Service Principal Risk Detections",
  category: "security",
  description: "Risk detections for workload identities (apps, managed identities).",
  requiredPermissions: ["IdentityRiskyServicePrincipal.Read.All"],
  baselineSupport: true,
  async fetch(transport) {
    return (
      await transport.get<SpRiskDetection>(
        "/identityProtection/servicePrincipalRiskDetections?$top=500&$select=id,riskEventType,riskLevel,riskState,servicePrincipalDisplayName,detectedDateTime",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const high = rows.filter((r) => r.riskLevel === "high");
    return {
      count: rows.length,
      variables: { totalDetections: rows.length, highRisk: high.length },
      rows: rows.slice(0, 50).map((r) => ({
        servicePrincipal: r.servicePrincipalDisplayName ?? "—",
        type: r.riskEventType ?? "—",
        level: r.riskLevel ?? "none",
        state: r.riskState ?? "—",
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
        // customSecurityAttributeAudits is a beta-only endpoint (no v1.0); the transport routes /beta/.
        "/beta/auditLogs/customSecurityAttributeAudits?$top=500&$select=id,activityDisplayName,result,initiatedBy,activityDateTime",
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
interface SpSignIn {
  id: string;
  appDisplayName?: string;
  servicePrincipalId?: string;
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
          "&$select=id,appDisplayName,servicePrincipalId,status,createdDateTime",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const failed = rows.filter((r) => (r.status?.errorCode ?? 0) !== 0);
    const apps = new Set(rows.map((r) => r.appDisplayName).filter(Boolean));
    return {
      count: rows.length,
      variables: { totalSignIns: rows.length, failed: failed.length, distinctApps: apps.size },
      rows: rows.slice(0, 50).map((r) => ({
        app: r.appDisplayName ?? "—",
        servicePrincipal: r.appDisplayName ?? r.servicePrincipalId ?? "—",
        result: (r.status?.errorCode ?? 0) === 0 ? "success" : r.status?.failureReason ?? "failed",
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
