import { defineReportPlugin } from "@/plugins/sdk";
import type { ReportSummary } from "@/services/reports/types";

const DAY = 86_400_000;
const DEFAULT_DORMANT_DAYS = 30;

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
  licenseNames?: string[];
  daysInactive?: number | null;
  reclaim?: boolean;
  recommendation?: string;
  thresholdDays?: number;
}

function recommend(enabled: boolean, days: number | null, threshold: number): { reclaim: boolean; text: string } {
  if (!enabled) return { reclaim: true, text: "Account is disabled but still holds a license — remove it to stop paying for an unused seat." };
  if (days === null) return { reclaim: true, text: "Has never signed in — remove the license unless this account is still being set up." };
  if (days > threshold) return { reclaim: true, text: `No sign-in in ${days} days — consider removing the license to free up the seat.` };
  return { reclaim: false, text: "Active — keep the license." };
}

export const plugin = defineReportPlugin<LicensedUser>({
  id: "dormant-licensed-users",
  version: "1.0.0",
  name: "License Reclamation",
  category: "identity",
  service: "Microsoft 365",
  icon: "licenses",
  dataSource: "graph-v1",
  metrics: ["Dormant licensed users","Reclaimable seats","Last sign-in age"],
  description:
    "Reclaimable Microsoft 365 licenses: users dormant past a threshold, never signed in, or disabled but still licensed (zombie licenses). Each row carries a recommendation to unassign or keep. Threshold is configurable per job (Advanced → dormant days, default 30).",
  requiredPermissions: ["User.Read.All", "AuditLog.Read.All", "Organization.Read.All"],
  baselineSupport: true,
  tags: ["licenses", "cost", "dormant"],
  recommendedSchedule: "weekly",
  recommendedGroup: "Argus - M365 Operations",
  rowKey: (row) => String(row.account),
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
});
