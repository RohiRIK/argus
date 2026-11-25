import { defineReportPlugin } from "@/plugins/sdk";
import type { ReportSummary } from "@/services/reports/types";

interface AppRegistration {
  displayName: string;
  appId: string;
  passwordCredentials?: { displayName?: string; endDateTime?: string }[];
  keyCredentials?: { displayName?: string; endDateTime?: string }[];
}

const DAY = 86_400_000;

export const plugin = defineReportPlugin<AppRegistration>({
  id: "app-secrets-expiry",
  version: "1.0.0",
  name: "App Secrets / Certificates Expiry",
  category: "infrastructure",
  service: "Microsoft Entra ID",
  icon: "credentials",
  dataSource: "graph-v1",
  metrics: ["Expiring secrets","Certificate expiry","Days remaining"],
  description: "Service principals with credentials expiring in 30/60/90 days.",
  requiredPermissions: ["Application.Read.All"],
  baselineSupport: false,
  tags: ["certificates", "secrets", "apps"],
  recommendedSchedule: "weekly",
  recommendedGroup: "Argus - M365 Operations",
  rowKey: (row) => `${row.app}|${row.credential}`,
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
});
