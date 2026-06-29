import type { ReportDefinition, ReportSummary } from "./types";

/**
 * Additional built-in report types (PRD §10). Each is a self-contained
 * ReportDefinition: fetch raw rows via the transport, summarize to metrics.
 */

interface RiskyUser {
  id: string;
  userPrincipalName: string;
  riskLevel?: "low" | "medium" | "high" | "none";
  riskState?: string;
}

export const riskyUsersReport: ReportDefinition<RiskyUser> = {
  id: "risky-users",
  name: "Risky Users Report",
  category: "identity",
  description: "Users flagged by Identity Protection, with risk levels.",
  requiredPermissions: ["IdentityRiskyUser.Read.All"],
  baselineSupport: true,
  // Identity = the user (UPN is unique per directory).
  rowKey: (row) => String(row.user),
  async fetch(transport) {
    return (
      await transport.get<RiskyUser>(
        // Identity Protection endpoints cap $top at 500 (999 → 400 Invalid page size); the transport pages the rest.
        "/identityProtection/riskyUsers?$top=500&$select=id,userPrincipalName,riskLevel,riskState",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const high = rows.filter((r) => r.riskLevel === "high");
    const atRisk = rows.filter((r) => r.riskState !== "remediated" && r.riskState !== "dismissed");
    return {
      count: atRisk.length,
      variables: {
        totalFlagged: rows.length,
        highRisk: high.length,
        atRisk: atRisk.length,
        topRiskUsers: high.slice(0, 5).map((u) => u.userPrincipalName).join(", ") || "none",
      },
      rows: atRisk.slice(0, 50).map((u) => ({
        user: u.userPrincipalName,
        level: u.riskLevel ?? "none",
        state: u.riskState ?? "—",
      })),
    };
  },
};

interface MfaUser {
  userPrincipalName: string;
  isMfaRegistered?: boolean;
  isMfaCapable?: boolean;
}

export const mfaRegistrationReport: ReportDefinition<MfaUser> = {
  id: "mfa-registration",
  name: "MFA Registration Status",
  category: "identity",
  description: "Who enrolled in MFA, who bypassed, who is pending.",
  requiredPermissions: ["AuditLog.Read.All", "UserAuthenticationMethod.Read.All"],
  baselineSupport: true,
  async fetch(transport) {
    return (
      await transport.get<MfaUser>(
        "/reports/authenticationMethods/userRegistrationDetails?$top=999&$select=userPrincipalName,isMfaRegistered,isMfaCapable",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const notRegistered = rows.filter((u) => !u.isMfaRegistered);
    return {
      count: notRegistered.length,
      variables: {
        totalUsers: rows.length,
        registered: rows.length - notRegistered.length,
        notRegistered: notRegistered.length,
        registeredPercent: rows.length ? Math.round(((rows.length - notRegistered.length) / rows.length) * 100) : 0,
      },
      rows: notRegistered.slice(0, 50).map((u) => ({ user: u.userPrincipalName, capable: String(Boolean(u.isMfaCapable)) })),
    };
  },
};

interface SubscribedSku {
  skuPartNumber: string;
  prepaidUnits?: { enabled?: number };
  consumedUnits?: number;
}

export const licenseUtilizationReport: ReportDefinition<SubscribedSku> = {
  id: "license-utilization",
  name: "License Utilization",
  category: "infrastructure",
  description: "Provisioning status, available vs. consumed licenses.",
  requiredPermissions: ["Organization.Read.All"],
  baselineSupport: true,
  async fetch(transport) {
    return (await transport.get<SubscribedSku>("/subscribedSkus")).value;
  },
  summarize(rows): ReportSummary {
    const totalEnabled = rows.reduce((a, s) => a + (s.prepaidUnits?.enabled ?? 0), 0);
    const totalConsumed = rows.reduce((a, s) => a + (s.consumedUnits ?? 0), 0);
    const detailed = rows.map((s) => {
      const enabled = s.prepaidUnits?.enabled ?? 0;
      const consumed = s.consumedUnits ?? 0;
      const available = enabled - consumed; // negative = over-allocated
      const isFree = /(^|_)FREE(_|$)/i.test(s.skuPartNumber); // free auto-assigned SKUs — no cost
      let recommendation: string;
      if (isFree) recommendation = "Free SKU — no cost, no action.";
      else if (available < 0) recommendation = `Over-allocated by ${-available} — you've assigned more than you bought (compliance risk). Buy seats or unassign.`;
      else if (enabled > 0 && available >= 5 && available / enabled >= 0.25) recommendation = `${available} unused seats — reclaim with License Reclamation, or drop at renewal.`;
      else recommendation = "Healthy.";
      return { sku: s.skuPartNumber, enabled, consumed, available, recommendation };
    });
    // SKUs needing attention = over-allocated or materially under-used (not healthy, not free).
    const needsAttn = (rec: string) => rec !== "Healthy." && !rec.startsWith("Free SKU");
    const attention = detailed.filter((s) => needsAttn(s.recommendation));
    return {
      count: attention.length,
      variables: {
        skus: rows.length,
        totalEnabled,
        totalConsumed,
        available: Math.max(0, totalEnabled - totalConsumed),
        needsAttention: attention.length,
      },
      // Attention SKUs first (over-allocated, then most free seats); healthy last.
      rows: [...detailed]
        .sort((a, b) => {
          const att = (s: { recommendation: string }) => (needsAttn(s.recommendation) ? 1 : 0);
          return att(b) - att(a) || a.available - b.available;
        })
        .slice(0, 50),
    };
  },
};

interface AppRegistration {
  displayName: string;
  appId: string;
  passwordCredentials?: { displayName?: string; endDateTime?: string }[];
  keyCredentials?: { displayName?: string; endDateTime?: string }[];
}

const DAY = 86_400_000;

export const appSecretsExpiryReport: ReportDefinition<AppRegistration> = {
  id: "app-secrets-expiry",
  name: "App Secrets / Certificates Expiry",
  category: "infrastructure",
  description: "Service principals with credentials expiring in 30/60/90 days.",
  requiredPermissions: ["Application.Read.All"],
  baselineSupport: false,
  async fetch(transport) {
    return (
      await transport.get<AppRegistration>(
        "/applications?$top=999&$select=displayName,appId,passwordCredentials,keyCredentials",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const now = Date.now();
    const expiring: { app: string; credential: string; days: number }[] = [];
    for (const app of rows) {
      for (const cred of [...(app.passwordCredentials ?? []), ...(app.keyCredentials ?? [])]) {
        if (!cred.endDateTime) continue;
        const days = Math.round((new Date(cred.endDateTime).getTime() - now) / DAY);
        if (days <= 90) expiring.push({ app: app.displayName, credential: cred.displayName ?? "secret", days });
      }
    }
    expiring.sort((a, b) => a.days - b.days);
    return {
      count: expiring.length,
      variables: {
        apps: rows.length,
        expiringWithin30: expiring.filter((e) => e.days <= 30).length,
        expiringWithin60: expiring.filter((e) => e.days <= 60).length,
        expiringWithin90: expiring.length,
        expired: expiring.filter((e) => e.days < 0).length,
      },
      rows: expiring.slice(0, 50).map((e) => ({ app: e.app, credential: e.credential, daysLeft: e.days })),
    };
  },
};
