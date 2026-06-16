import type { ReportDefinition, ReportSummary } from "./types";

/** A single sign-in audit record (subset of Graph /auditLogs/signIns). */
export interface SignIn {
  id: string;
  userPrincipalName: string;
  appDisplayName?: string;
  appId?: string;
  ipAddress?: string;
  status?: { errorCode?: number; failureReason?: string };
  location?: { city?: string; countryOrRegion?: string };
  clientAppUsed?: string;
  createdDateTime?: string;
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

// Common Entra sign-in error codes → plain reason + what to do. Saves the admin
// decoding AADSTS numbers and Microsoft's templated failureReason strings.
const ERROR_CODES: Record<number, { reason: string; recommendation: string }> = {
  50126: { reason: "Wrong username or password", recommendation: "Usually a typo — but many attempts from one IP can mean password-spray. Watch the source." },
  50053: { reason: "Account locked after too many attempts", recommendation: "Investigate the source IP for brute force, then unlock the user if it's legitimate." },
  50055: { reason: "Password expired", recommendation: "Have the user reset their password." },
  50057: { reason: "Account is disabled", recommendation: "Expected for offboarded users; otherwise investigate why it's being used." },
  50074: { reason: "MFA required but not completed", recommendation: "Confirm the user can complete MFA on their device." },
  50076: { reason: "MFA required", recommendation: "Make sure the user is registered for MFA." },
  50079: { reason: "MFA registration required", recommendation: "Ask the user to finish MFA registration." },
  53003: { reason: "Blocked by a Conditional Access policy", recommendation: "Usually expected policy enforcement — confirm it's intended." },
  65001: { reason: "App needs admin consent", recommendation: "Grant admin consent for the app, or block it if the request is unexpected." },
  50011: { reason: "App redirect URL mismatch", recommendation: "The app's reply/redirect URI doesn't match its Entra registration — fix the app's redirect URI." },
  500113: { reason: "No redirect address registered for the app", recommendation: "Add a redirect URI to the app registration in Entra." },
  500121: { reason: "Authentication not completed (MFA/strong auth)", recommendation: "User didn't finish the required authentication — confirm their MFA method works." },
  50034: { reason: "User doesn't exist in the directory", recommendation: "Often recon or a typo — keep an eye on the source IP." },
  700016: { reason: "App not found in the tenant", recommendation: "Stale or suspicious app reference — investigate the source." },
};

function explain(code: number | undefined, raw?: string): { reason: string; recommendation: string } {
  if (code && ERROR_CODES[code]) return ERROR_CODES[code];
  // Microsoft's templated reasons ({identifier}, {namePhrase}, …) mangle if we
  // strip the tokens, so only trust a raw reason that has none. Otherwise show a
  // clean code reference instead of a garbled sentence.
  const hasPlaceholder = /\{[^}]*\}/.test(raw ?? "");
  if (raw && !hasPlaceholder) return { reason: raw, recommendation: "Review the sign-in details in Entra." };
  return {
    reason: code ? `Sign-in failed (error ${code})` : "Sign-in failed",
    recommendation: "Look up this error code in the Entra sign-in logs.",
  };
}

interface SignInGroup {
  user: string;
  app: string;
  status: string;
  attempts: number;
  lastSeen: number; // epoch ms of the most recent attempt
  date: string;
  ip: string;
  country: string;
  reason: string;
  recommendation: string;
  _failed: boolean;
}

function appLabel(r: SignIn): string {
  if (r.appDisplayName) return r.appId ? `${r.appDisplayName} (${r.appId})` : r.appDisplayName;
  return r.appId ?? "—";
}

// Group sign-ins by user + result + app. Failures carry a decoded reason +
// recommendation; successes are shown for context. Failures sort to the top.
function aggregateSignIns(rows: SignIn[]): Record<string, string | number>[] {
  const groups = new Map<string, SignInGroup>();
  for (const r of rows) {
    const code = r.status?.errorCode;
    const failed = Boolean(code && code !== 0);
    const key = `${r.userPrincipalName}|${code ?? 0}|${r.appId ?? ""}`;
    const ts = r.createdDateTime ? Date.parse(r.createdDateTime) : 0;
    const existing = groups.get(key);
    if (existing) {
      existing.attempts += 1;
      if (ts > existing.lastSeen) {
        existing.lastSeen = ts;
        existing.date = r.createdDateTime?.slice(0, 16).replace("T", " ") ?? existing.date;
      }
    } else {
      const ex = failed ? explain(code, r.status?.failureReason) : { reason: "—", recommendation: "—" };
      groups.set(key, {
        user: r.userPrincipalName,
        app: appLabel(r),
        status: failed ? "Failed" : "Success",
        attempts: 1,
        lastSeen: ts,
        date: r.createdDateTime?.slice(0, 16).replace("T", " ") ?? "—",
        ip: r.ipAddress ?? "—",
        country: r.location?.countryOrRegion ?? "—",
        reason: ex.reason,
        recommendation: ex.recommendation,
        _failed: failed,
      });
    }
  }
  return [...groups.values()]
    .sort((a, b) => Number(b._failed) - Number(a._failed) || b.attempts - a.attempts)
    .slice(0, 50)
    .map(({ _failed, lastSeen, ...row }) => row); // drop internal sort fields
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
      "/auditLogs/signIns?$top=1000&$orderby=createdDateTime desc" +
        "&$select=id,userPrincipalName,appDisplayName,appId,ipAddress,status,location,clientAppUsed,createdDateTime",
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
      // Anomalies only — failed sign-ins, grouped by user + error + app with a
      // decoded reason, recommendation, last-seen date, and attempt count.
      rows: aggregateSignIns(failed),
    };
  },
};
