import type { ReportDefinition, ReportSummary } from "./types";

/**
 * Tier-1 report candidates from docs/new-reports.md — JSON drop-ins that reuse
 * the existing GraphTransport.get(). No new transport infrastructure required.
 */

// ── Security: Secure Score Trend ─────────────────────────────────────────────
interface SecureScoreRecord {
  id: string;
  currentScore?: number;
  maxScore?: number;
  enabledServices?: string[];
  averageComparativeScores?: { basis: string; averageScore: number }[];
  controlScores?: { controlCategory: string; controlName: string; score: number }[];
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
    const controlScore = (category: string) =>
      latest?.controlScores?.find((c) => c.controlCategory === category)?.score ?? 0;
    const current = latest?.currentScore ?? 0;
    const max = latest?.maxScore ?? 0;
    return {
      count: Math.round(current),
      variables: {
        currentScore: Math.round(current),
        maxScore: Math.round(max),
        pctOfMax: max ? Math.round((current / max) * 100) : 0,
        identityControls: controlScore("Identity"),
        dataControls: controlScore("Data"),
        deviceControls: controlScore("Device"),
        peerAvg: Math.round(
          latest?.averageComparativeScores?.find((a) => a.basis === "AllTenants")?.averageScore ?? 0,
        ),
      },
      rows: (latest?.controlScores ?? []).slice(0, 50).map((c) => ({
        category: c.controlCategory,
        control: c.controlName,
        score: c.score,
      })),
    };
  },
};

// ── Infrastructure: Provisioning Log Summary ─────────────────────────────────
interface ProvisioningEvent {
  id: string;
  activityDateTime?: string;
  action?: string;
  provisioningStatusInfo?: { status?: "success" | "failure" | "skipped" | "warning" };
  sourceIdentity?: { displayName?: string };
  targetIdentity?: { displayName?: string };
  servicePrincipal?: { displayName?: string };
}

export const provisioningSummaryReport: ReportDefinition<ProvisioningEvent> = {
  id: "provisioning-summary",
  name: "Provisioning Log Summary",
  category: "infrastructure",
  description: "HR-to-Entra and SCIM sync events — surfaces failed and skipped provisioning.",
  requiredPermissions: ["AuditLog.Read.All", "Directory.Read.All"],
  baselineSupport: true,
  async fetch(transport) {
    return (
      await transport.get<ProvisioningEvent>(
        "/auditLogs/provisioning?$top=999&$select=id,activityDateTime,action,provisioningStatusInfo,sourceIdentity,targetIdentity,servicePrincipal",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const statusOf = (e: ProvisioningEvent) => e.provisioningStatusInfo?.status ?? "unknown";
    const failures = rows.filter((e) => statusOf(e) === "failure");
    const skipped = rows.filter((e) => statusOf(e) === "skipped");
    const byAction = rows.reduce<Record<string, number>>((acc, e) => {
      const a = e.action ?? "other";
      acc[a] = (acc[a] ?? 0) + 1;
      return acc;
    }, {});
    return {
      count: failures.length,
      variables: {
        totalEvents: rows.length,
        failures: failures.length,
        skipped: skipped.length,
        actions: Object.entries(byAction).map(([k, v]) => `${k}: ${v}`).join(", "),
      },
      rows: failures.slice(0, 50).map((e) => ({
        target: e.targetIdentity?.displayName ?? "—",
        app: e.servicePrincipal?.displayName ?? "—",
        action: e.action ?? "—",
        status: statusOf(e),
      })),
    };
  },
};

// ── Security: Risky Service Principals ───────────────────────────────────────
interface RiskyServicePrincipal {
  id: string;
  displayName?: string;
  appId?: string;
  isEnabled?: boolean;
  riskLevel?: "low" | "medium" | "high" | "none";
  riskState?: "atRisk" | "confirmedCompromised" | "remediated" | "dismissed" | "none";
}

export const riskyServicePrincipalsReport: ReportDefinition<RiskyServicePrincipal> = {
  id: "risky-service-principals",
  name: "Risky Service Principals",
  category: "security",
  description: "Non-human identities (apps, managed identities) flagged by Identity Protection.",
  requiredPermissions: ["IdentityRiskyServicePrincipal.Read.All"],
  baselineSupport: true,
  async fetch(transport) {
    return (
      await transport.get<RiskyServicePrincipal>(
        // Identity Protection endpoints cap $top at 500 (999 → 400); the transport pages the rest via @odata.nextLink.
        "/identityProtection/riskyServicePrincipals?$top=500&$select=id,displayName,appId,isEnabled,riskLevel,riskState",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const high = rows.filter((r) => r.riskLevel === "high");
    const atRisk = rows.filter((r) => r.riskState === "atRisk" || r.riskState === "confirmedCompromised");
    return {
      count: atRisk.length,
      variables: {
        totalFlagged: rows.length,
        highRisk: high.length,
        atRisk: atRisk.length,
        compromised: rows.filter((r) => r.riskState === "confirmedCompromised").length,
        topRisky: high.slice(0, 5).map((r) => r.displayName ?? r.appId ?? "—").join(", ") || "none",
      },
      rows: atRisk.slice(0, 50).map((r) => ({
        servicePrincipal: r.displayName ?? "—",
        appId: r.appId ?? "—",
        level: r.riskLevel ?? "none",
        state: r.riskState ?? "—",
      })),
    };
  },
};
