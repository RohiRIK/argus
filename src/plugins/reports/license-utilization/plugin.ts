import { defineReportPlugin } from "@/plugins/sdk";
import type { ReportSummary } from "@/services/reports/types";

interface SubscribedSku {
  skuPartNumber: string;
  prepaidUnits?: { enabled?: number };
  consumedUnits?: number;
}

export const plugin = defineReportPlugin<SubscribedSku>({
  id: "license-utilization",
  version: "1.0.0",
  name: "License Utilization",
  category: "infrastructure",
  description: "Provisioning status, available vs. consumed licenses.",
  requiredPermissions: ["Organization.Read.All"],
  baselineSupport: true,
  tags: ["licenses", "subscriptions", "cost"],
  recommendedSchedule: "weekly",
  recommendedGroup: "Argus - M365 Operations",
  rowKey: (row) => String(row.sku),
  async fetch(transport) {
    return (await transport.get<SubscribedSku>("/subscribedSkus")).value;
  },
  summarize(rows): ReportSummary {
    const totalEnabled = rows.reduce((a, s) => a + (s.prepaidUnits?.enabled ?? 0), 0);
    const totalConsumed = rows.reduce((a, s) => a + (s.consumedUnits ?? 0), 0);
    const detailed = rows.map((s) => {
      const enabled = s.prepaidUnits?.enabled ?? 0;
      const consumed = s.consumedUnits ?? 0;
      const available = enabled - consumed;
      const isFree = /(^|_)FREE(_|$)/i.test(s.skuPartNumber);
      let recommendation: string;
      if (isFree) recommendation = "Free SKU — no cost, no action.";
      else if (available < 0) recommendation = `Over-allocated by ${-available} — you've assigned more than you bought (compliance risk). Buy seats or unassign.`;
      else if (enabled > 0 && available >= 5 && available / enabled >= 0.25) recommendation = `${available} unused seats — reclaim with License Reclamation, or drop at renewal.`;
      else recommendation = "Healthy.";
      return { sku: s.skuPartNumber, enabled, consumed, available, recommendation };
    });
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
      rows: [...detailed]
        .sort((a, b) => {
          const att = (s: { recommendation: string }) => (needsAttn(s.recommendation) ? 1 : 0);
          return att(b) - att(a) || a.available - b.available;
        })
        .slice(0, 50),
    };
  },
});
