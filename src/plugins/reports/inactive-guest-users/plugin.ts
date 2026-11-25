import { defineReportPlugin } from "@/plugins/sdk";
import type { ReportSummary } from "@/services/reports/types";

const DAY = 86_400_000;

interface GuestUser {
  id: string;
  userPrincipalName: string;
  userType?: string;
  signInActivity?: { lastSignInDateTime?: string };
  createdDateTime?: string;
}

export const plugin = defineReportPlugin<GuestUser>({
  id: "inactive-guest-users",
  version: "1.0.0",
  name: "Inactive Guest Users",
  category: "identity",
  description: "External users who have not signed in for 90+ days.",
  requiredPermissions: ["User.Read.All", "AuditLog.Read.All"],
  baselineSupport: true,
  tags: ["b2b", "guests", "hygiene"],
  recommendedSchedule: "weekly",
  recommendedGroup: "Argus - Identity & Access",
  rowKey: (row) => String(row.user),
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
});
