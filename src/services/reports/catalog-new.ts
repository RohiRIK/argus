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
  createdDateTime?: string;
  activeUserCount?: number;
  licensedUserCount?: number;
  enabledServices?: string[];
  averageComparativeScores?: { basis: string; averageScore: number }[];
  controlScores?: SecureScoreControl[];
}

interface SecureScoreControl {
  controlCategory: string;
  controlName: string;
  description?: string;
  score: number;
  implementationStatus?: string;
  scoreInPercentage?: number;
}

function stripHtml(value?: string): string {
  const decoded = (value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&ldquo;/g, "\"")
    .replace(/&rdquo;/g, "\"")
    .replace(/&lsquo;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
  return decoded.replace(/\s+/g, " ").trim();
}

function scorePct(score: number, max: number): number {
  return max ? Math.round((score / max) * 100) : 0;
}

function categoryScore(latest: SecureScoreRecord | undefined, category: string): number {
  return latest?.controlScores?.filter((c) => c.controlCategory === category).reduce((sum, c) => sum + c.score, 0) ?? 0;
}

function controlRecommendation(control: SecureScoreControl): string {
  const pct = control.scoreInPercentage ?? 0;
  if (control.score === 0) return "Not implemented — implement this control to raise Secure Score.";
  if (pct < 50) return "Partially implemented — finish remaining implementation steps.";
  return "Implemented — keep configuration in place.";
}

function controlStatus(control: SecureScoreControl): string {
  return stripHtml(control.implementationStatus) || "—";
}

export const secureScoreReport: ReportDefinition<SecureScoreRecord> = {
  id: "secure-score",
  name: "Secure Score Trend",
  category: "security",
  description: "Tenant Secure Score with per-control breakdown and peer benchmarks.",
  requiredPermissions: ["SecurityEvents.Read.All"],
  baselineSupport: true,
  async fetch(transport) {
    return (await transport.get<SecureScoreRecord>("/security/secureScores?$top=7")).value;
  },
  summarize(rows): ReportSummary {
    const latest = rows[0];
    const previous = rows[1];
    const current = latest?.currentScore ?? 0;
    const max = latest?.maxScore ?? 0;
    const previousScore = previous?.currentScore ?? 0;
    const delta = current - previousScore;
    const controls = [...(latest?.controlScores ?? [])].sort((a, b) => a.score - b.score || a.controlName.localeCompare(b.controlName));
    return {
      count: Math.round(current),
      variables: {
        currentScore: Math.round(current),
        maxScore: Math.round(max),
        pctOfMax: scorePct(current, max),
        previousScore: Math.round(previousScore),
        scoreDelta: Math.round(delta),
        scoreTrend: delta === 0 ? "flat" : delta > 0 ? "up" : "down",
        peerAvg: Math.round(latest?.averageComparativeScores?.find((a) => a.basis === "AllTenants")?.averageScore ?? 0),
        identityControls: Math.round(categoryScore(latest, "Identity")),
        dataControls: Math.round(categoryScore(latest, "Data")),
        deviceControls: Math.round(categoryScore(latest, "Device")),
        appsControls: Math.round(categoryScore(latest, "Apps")),
        infrastructureControls: Math.round(categoryScore(latest, "Infrastructure")),
        activeUsers: latest?.activeUserCount ?? 0,
        licensedUsers: latest?.licensedUserCount ?? 0,
        enabledServices: (latest?.enabledServices ?? []).join(", ") || "—",
        snapshotDate: latest?.createdDateTime ? latest.createdDateTime.slice(0, 10) : "—",
      },
      rows: controls.slice(0, 50).map((c) => ({
        category: c.controlCategory,
        control: c.controlName,
        score: c.score,
        pct: c.scoreInPercentage ?? 0,
        status: controlStatus(c),
        recommendation: controlRecommendation(c),
      })),
    };
  },
};

// ── Infrastructure: Provisioning Log Summary ─────────────────────────────────
interface ProvisioningEvent {
  id: string;
  activityDateTime?: string;
  provisioningAction?: string;
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
        // /auditLogs/provisioning does not allow $select — request the full objects.
        "/auditLogs/provisioning?$top=999",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const statusOf = (e: ProvisioningEvent) => e.provisioningStatusInfo?.status ?? "unknown";
    const failures = rows.filter((e) => statusOf(e) === "failure");
    const skipped = rows.filter((e) => statusOf(e) === "skipped");
    const byAction = rows.reduce<Record<string, number>>((acc, e) => {
      const a = e.provisioningAction ?? "other";
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
        action: e.provisioningAction ?? "—",
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
