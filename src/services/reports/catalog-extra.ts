import type { ReportDefinition, ReportSummary } from "./types";

/** Remaining built-in reports (PRD §10.1–10.4) completing the catalog. */

const DAY = 86_400_000;

// ── Identity: Inactive Guest Users ───────────────────────────────────────────
interface GuestUser {
  id: string;
  userPrincipalName: string;
  userType?: string;
  signInActivity?: { lastSignInDateTime?: string };
  createdDateTime?: string;
}

export const inactiveGuestUsersReport: ReportDefinition<GuestUser> = {
  id: "inactive-guest-users",
  name: "Inactive Guest Users",
  category: "identity",
  description: "External users who have not signed in for 90+ days.",
  requiredPermissions: ["User.Read.All", "AuditLog.Read.All"],
  baselineSupport: true,
  async fetch(transport) {
    return (
      await transport.get<GuestUser>(
        "/users?$filter=userType eq 'Guest'&$select=id,userPrincipalName,userType,signInActivity,createdDateTime&$top=999",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const now = Date.now();
    const inactive = rows.filter((u) => {
      const last = u.signInActivity?.lastSignInDateTime;
      const ref = last ?? u.createdDateTime;
      return !ref || now - new Date(ref).getTime() > 90 * DAY;
    });
    return {
      count: inactive.length,
      variables: {
        totalGuests: rows.length,
        inactiveGuests: inactive.length,
        neverSignedIn: rows.filter((u) => !u.signInActivity?.lastSignInDateTime).length,
      },
      rows: inactive.slice(0, 50).map((u) => ({
        user: u.userPrincipalName,
        lastSignIn: u.signInActivity?.lastSignInDateTime ?? "never",
      })),
    };
  },
};

// ── Identity: Dormant Licensed Users ─────────────────────────────────────────
// Licensed users who haven't signed in for 30+ days — reclaim wasted licenses,
// flag abandoned/orphaned accounts. Joins /users (sign-in + licenses) with
// /subscribedSkus to show the human license name (skuPartNumber), not a GUID.
interface SubscribedSku {
  skuId: string;
  skuPartNumber: string;
}
interface LicensedUser {
  id: string;
  displayName?: string;
  userPrincipalName: string;
  accountEnabled?: boolean;
  signInActivity?: { lastSignInDateTime?: string };
  assignedLicenses?: { skuId: string }[];
  // ── Enriched in fetch() ──
  licenseNames?: string[];
  daysInactive?: number | null; // null = never signed in
  reclaim?: boolean;
  recommendation?: string;
  thresholdDays?: number;
}

const DEFAULT_DORMANT_DAYS = 30;

/** Plain-English recommendation per licensed user. Priority: disabled > never > dormant > keep. */
function recommend(enabled: boolean, days: number | null, threshold: number): { reclaim: boolean; text: string } {
  if (!enabled) return { reclaim: true, text: "Account is disabled but still holds a license — remove it to stop paying for an unused seat." };
  if (days === null) return { reclaim: true, text: "Has never signed in — remove the license unless this account is still being set up." };
  if (days > threshold) return { reclaim: true, text: `No sign-in in ${days} days — consider removing the license to free up the seat.` };
  return { reclaim: false, text: "Active — keep the license." };
}

export const dormantLicensedUsersReport: ReportDefinition<LicensedUser> = {
  id: "dormant-licensed-users",
  name: "License Reclamation",
  category: "identity",
  description:
    "Reclaimable Microsoft 365 licenses: users dormant past a threshold, never signed in, or disabled but still licensed (zombie licenses). Each row carries a recommendation to unassign or keep. Threshold is configurable per job (Advanced → dormant days, default 30).",
  requiredPermissions: ["User.Read.All", "AuditLog.Read.All", "Organization.Read.All"],
  baselineSupport: true,
  async fetch(transport, params) {
    const threshold = Number(params?.dormantDays) > 0 ? Number(params.dormantDays) : DEFAULT_DORMANT_DAYS;
    const [users, skus] = await Promise.all([
      transport.get<LicensedUser>(
        "/users?$select=id,displayName,userPrincipalName,accountEnabled,signInActivity,assignedLicenses&$top=999",
      ),
      transport.get<SubscribedSku>("/subscribedSkus"),
    ]);
    const skuName = new Map(skus.value.map((s) => [s.skuId, s.skuPartNumber]));
    const now = Date.now();
    // Licensed users only, enriched with inactivity + a reclaim recommendation.
    return users.value
      .filter((u) => (u.assignedLicenses?.length ?? 0) > 0)
      .map((u) => {
        const last = u.signInActivity?.lastSignInDateTime;
        const daysInactive = last ? Math.floor((now - new Date(last).getTime()) / DAY) : null;
        const enabled = u.accountEnabled !== false;
        const rec = recommend(enabled, daysInactive, threshold);
        return {
          ...u,
          licenseNames: (u.assignedLicenses ?? []).map((l) => skuName.get(l.skuId) ?? l.skuId),
          daysInactive,
          reclaim: rec.reclaim,
          recommendation: rec.text,
          thresholdDays: threshold,
        };
      });
  },
  summarize(rows): ReportSummary {
    const reclaim = rows.filter((u) => u.reclaim);
    return {
      count: reclaim.length,
      variables: {
        licensedUsers: rows.length,
        reclaimable: reclaim.length,
        disabledLicensed: rows.filter((u) => u.accountEnabled === false).length,
        neverSignedIn: rows.filter((u) => u.daysInactive === null).length,
        thresholdDays: rows[0]?.thresholdDays ?? DEFAULT_DORMANT_DAYS,
      },
      rows: reclaim.slice(0, 50).map((u) => ({
        user: u.displayName || u.userPrincipalName,
        account: u.userPrincipalName,
        licenses: (u.licenseNames ?? []).join(", ") || "—",
        status: u.accountEnabled === false ? "disabled" : "enabled",
        lastSignIn: u.daysInactive === null ? "never" : `${u.daysInactive}d ago`,
        recommendation: u.recommendation ?? "",
      })),
    };
  },
};

// ── Security: Alerts Digest + DLP (both /security/alerts_v2) ──────────────────
interface SecurityAlert {
  id: string;
  title?: string;
  severity?: "informational" | "low" | "medium" | "high";
  status?: string;
  category?: string;
  createdDateTime?: string;
}

function severityCounts(alerts: SecurityAlert[]) {
  return {
    high: alerts.filter((a) => a.severity === "high").length,
    medium: alerts.filter((a) => a.severity === "medium").length,
    low: alerts.filter((a) => a.severity === "low").length,
  };
}

export const securityAlertsDigestReport: ReportDefinition<SecurityAlert> = {
  id: "security-alerts-digest",
  name: "Security Alerts Digest",
  category: "security",
  description: "Aggregated alerts from Microsoft Defender / Sentinel.",
  // alerts_v2 (M365 Defender) requires SecurityAlert.Read.All, not the legacy SecurityEvents.Read.All.
  requiredPermissions: ["SecurityAlert.Read.All"],
  baselineSupport: true,
  async fetch(transport) {
    return (
      await transport.get<SecurityAlert>(
        "/security/alerts_v2?$top=999&$select=id,title,severity,status,category,createdDateTime",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const sev = severityCounts(rows);
    const active = rows.filter((a) => a.status !== "resolved");
    return {
      count: active.length,
      variables: { totalAlerts: rows.length, activeAlerts: active.length, ...sev },
      rows: rows
        .filter((a) => a.severity === "high" || a.severity === "medium")
        .slice(0, 50)
        .map((a) => ({ title: a.title ?? "—", severity: a.severity ?? "—", status: a.status ?? "—" })),
    };
  },
};

export const dlpAlertsReport: ReportDefinition<SecurityAlert> = {
  id: "dlp-alerts",
  name: "DLP Alerts",
  category: "security",
  description: "Data loss prevention incidents from security alerts.",
  requiredPermissions: ["SecurityAlert.Read.All"],
  baselineSupport: true,
  async fetch(transport) {
    return (
      await transport.get<SecurityAlert>(
        "/security/alerts_v2?$filter=category eq 'DataLossPrevention'&$top=999" +
          "&$select=id,title,severity,status,category,createdDateTime",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const sev = severityCounts(rows);
    return {
      count: rows.length,
      variables: { dlpIncidents: rows.length, ...sev },
      rows: rows.slice(0, 50).map((a) => ({ title: a.title ?? "—", severity: a.severity ?? "—" })),
    };
  },
};

// ── Security: Conditional Access Failures (/auditLogs/signIns) ────────────────
interface CaSignIn {
  id: string;
  userPrincipalName: string;
  conditionalAccessStatus?: "success" | "failure" | "notApplied";
  status?: { failureReason?: string };
  appDisplayName?: string;
}

export const conditionalAccessFailuresReport: ReportDefinition<CaSignIn> = {
  id: "conditional-access-failures",
  name: "Conditional Access Failures",
  category: "security",
  description: "Blocked sign-ins, policy gaps, device non-compliance.",
  requiredPermissions: ["AuditLog.Read.All"],
  baselineSupport: true,
  async fetch(transport) {
    return (
      await transport.get<CaSignIn>(
        "/auditLogs/signIns?$filter=conditionalAccessStatus eq 'failure'&$top=999" +
          "&$select=id,userPrincipalName,conditionalAccessStatus,status,appDisplayName",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const users = new Set(rows.map((r) => r.userPrincipalName));
    const apps = new Set(rows.map((r) => r.appDisplayName).filter(Boolean));
    return {
      count: rows.length,
      variables: {
        blockedSignIns: rows.length,
        affectedUsers: users.size,
        affectedApps: apps.size,
      },
      rows: rows.slice(0, 50).map((r) => ({
        user: r.userPrincipalName,
        app: r.appDisplayName ?? "—",
        reason: r.status?.failureReason ?? "policy block",
      })),
    };
  },
};

// ── Infrastructure: Device Compliance (Intune) ───────────────────────────────
interface ManagedDevice {
  id: string;
  deviceName?: string;
  complianceState?: "compliant" | "noncompliant" | "unknown" | "error";
  operatingSystem?: string;
  osVersion?: string;
}

export const deviceComplianceReport: ReportDefinition<ManagedDevice> = {
  id: "device-compliance",
  name: "Device Compliance (Intune)",
  category: "infrastructure",
  description: "Non-compliant devices, pending actions, OS versions.",
  requiredPermissions: ["DeviceManagementManagedDevices.Read.All"],
  baselineSupport: true,
  async fetch(transport) {
    return (
      await transport.get<ManagedDevice>(
        "/deviceManagement/managedDevices?$top=999&$select=id,deviceName,complianceState,operatingSystem,osVersion",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const noncompliant = rows.filter((d) => d.complianceState === "noncompliant");
    const byOs = rows.reduce<Record<string, number>>((acc, d) => {
      const os = d.operatingSystem ?? "unknown";
      acc[os] = (acc[os] ?? 0) + 1;
      return acc;
    }, {});
    return {
      count: noncompliant.length,
      variables: {
        totalDevices: rows.length,
        nonCompliant: noncompliant.length,
        compliant: rows.filter((d) => d.complianceState === "compliant").length,
        osBreakdown: Object.entries(byOs).map(([k, v]) => `${k}: ${v}`).join(", "),
      },
      rows: noncompliant.slice(0, 50).map((d) => ({
        device: d.deviceName ?? "—",
        os: `${d.operatingSystem ?? "?"} ${d.osVersion ?? ""}`.trim(),
        state: d.complianceState ?? "unknown",
      })),
    };
  },
};

// ── Infrastructure: Audit Log Summary ────────────────────────────────────────
interface DirectoryAudit {
  id: string;
  activityDisplayName?: string;
  category?: string;
  result?: string;
  initiatedBy?: { user?: { userPrincipalName?: string } };
}

export const auditLogSummaryReport: ReportDefinition<DirectoryAudit> = {
  id: "audit-log-summary",
  name: "Audit Log Summary",
  category: "infrastructure",
  description: "User creation, role changes, policy modifications.",
  requiredPermissions: ["AuditLog.Read.All"],
  baselineSupport: true,
  async fetch(transport) {
    return (
      await transport.get<DirectoryAudit>(
        "/auditLogs/directoryAudits?$top=999&$select=id,activityDisplayName,category,result,initiatedBy",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const byCategory = rows.reduce<Record<string, number>>((acc, r) => {
      const c = r.category ?? "other";
      acc[c] = (acc[c] ?? 0) + 1;
      return acc;
    }, {});
    const failures = rows.filter((r) => r.result === "failure");
    return {
      count: rows.length,
      variables: {
        totalEvents: rows.length,
        failures: failures.length,
        categories: Object.entries(byCategory).map(([k, v]) => `${k}: ${v}`).join(", "),
      },
      rows: rows.slice(0, 50).map((r) => ({
        activity: r.activityDisplayName ?? "—",
        category: r.category ?? "—",
        by: r.initiatedBy?.user?.userPrincipalName ?? "system",
        result: r.result ?? "—",
      })),
    };
  },
};

// ── Custom: Manual Graph Query ───────────────────────────────────────────────
export const manualGraphQueryReport: ReportDefinition<Record<string, unknown>> = {
  id: "manual-graph-query",
  name: "Manual Graph Query",
  category: "custom",
  description: "Run a custom Graph endpoint + $filter + $select and email the results.",
  requiredPermissions: ["(depends on endpoint)"],
  baselineSupport: false,
  async fetch(transport, params) {
    const endpoint = typeof params.endpoint === "string" ? params.endpoint : "";
    if (!endpoint) throw new Error("Manual Graph Query requires a 'endpoint' parameter");
    const qs: string[] = [];
    if (typeof params.filter === "string" && params.filter) qs.push(`$filter=${params.filter}`);
    if (typeof params.select === "string" && params.select) qs.push(`$select=${params.select}`);
    const path = qs.length ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}${qs.join("&")}` : endpoint;
    return (await transport.get<Record<string, unknown>>(path)).value;
  },
  summarize(rows): ReportSummary {
    const keys = rows[0] ? Object.keys(rows[0]).slice(0, 6) : [];
    return {
      count: rows.length,
      variables: { records: rows.length, fields: keys.join(", ") || "—" },
      rows: rows.slice(0, 50).map((r) => {
        const out: Record<string, string | number> = {};
        for (const k of keys) {
          const v = (r as Record<string, unknown>)[k];
          out[k] = typeof v === "object" ? JSON.stringify(v) : (v as string | number);
        }
        return out;
      }),
    };
  },
};
