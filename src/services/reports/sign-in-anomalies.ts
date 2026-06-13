import type { ReportDefinition, ReportSummary } from "./types";

/** A single sign-in audit record (subset of Graph /auditLogs/signIns). */
export interface SignIn {
  id: string;
  userPrincipalName: string;
  ipAddress?: string;
  status?: { errorCode?: number; failureReason?: string };
  location?: { city?: string; countryOrRegion?: string };
  clientAppUsed?: string;
}

const LEGACY_AUTH_CLIENTS = new Set([
  "Other clients",
  "IMAP4",
  "POP3",
  "SMTP",
  "Exchange ActiveSync",
]);

function isFailed(s: SignIn): boolean {
  return Boolean(s.status?.errorCode && s.status.errorCode !== 0);
}

/** Daily Sign-in Anomalies (PRD §10.1) — failed sign-ins, legacy auth, etc. */
export const signInAnomaliesReport: ReportDefinition<SignIn> = {
  id: "sign-in-anomalies",
  name: "Daily Sign-in Anomalies",
  category: "identity",
  description: "Failed sign-ins, unfamiliar locations, anonymous IPs, legacy auth.",
  requiredPermissions: ["AuditLog.Read.All"],
  baselineSupport: true,

  async fetch(transport) {
    const page = await transport.get<SignIn>(
      "/auditLogs/signIns?$top=1000&$orderby=createdDateTime desc",
    );
    return page.value;
  },

  summarize(rows: SignIn[]): ReportSummary {
    const failed = rows.filter(isFailed);
    const legacy = rows.filter((r) => r.clientAppUsed && LEGACY_AUTH_CLIENTS.has(r.clientAppUsed));
    const countries = new Set(rows.map((r) => r.location?.countryOrRegion).filter(Boolean));
    const topUsers = [...new Set(failed.map((r) => r.userPrincipalName))].slice(0, 5);

    return {
      count: failed.length,
      variables: {
        totalSignIns: rows.length,
        failedSignIns: failed.length,
        legacyAuthSignIns: legacy.length,
        distinctCountries: countries.size,
        topRiskUsers: topUsers.join(", ") || "none",
      },
      rows: failed.slice(0, 50).map((r) => ({
        user: r.userPrincipalName,
        ip: r.ipAddress ?? "—",
        reason: r.status?.failureReason ?? "unknown",
        country: r.location?.countryOrRegion ?? "—",
      })),
    };
  },
};
