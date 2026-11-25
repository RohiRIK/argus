import type { GraphTransport } from "@/services/graph/client";

export type CsvRow = Record<string, string>;
export const REPORTS_PERM = ["Reports.Read.All"] as const;
const DAY = 86_400_000;

/**
 * Returns the first NON-EMPTY value among candidate columns matched by header
 * substring. Falling through on empty handles tenants with anonymized/concealed fields.
 */
export function col(row: CsvRow, ...needles: string[]): string {
  const keys = Object.keys(row);
  for (const n of needles) {
    const k = keys.find((key) => key.toLowerCase().includes(n.toLowerCase()));
    if (k && row[k]?.trim()) return row[k];
  }
  return "";
}

export function num(v: string): number {
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function isStale(lastActivity: string, days = 7): boolean {
  if (!lastActivity) return true;
  const t = Date.parse(lastActivity);
  return Number.isNaN(t) ? true : Date.now() - t > days * DAY;
}

function servicePairs(row: CsvRow): string[] {
  const services = new Set<string>();
  for (const key of Object.keys(row)) {
    const activeMatch = key.match(/^(.*)\s+Active$/i);
    const inactiveMatch = key.match(/^(.*)\s+Inactive$/i);
    const service = activeMatch?.[1] ?? inactiveMatch?.[1];
    if (service) services.add(service.trim());
  }
  return [...services];
}

function serviceCell(row: CsvRow, service: string, suffix: "Active" | "Inactive"): string {
  const needle = `${service} ${suffix}`.toLowerCase();
  return Object.entries(row).find(([key]) => key.toLowerCase() === needle)?.[1] ?? "";
}

export function extractServicePairs(row: CsvRow): string[] {
  return servicePairs(row);
}

export function serviceRows(row: CsvRow) {
  const services = servicePairs(row);
  if (services.length === 0) {
    const service = col(row, "Service Display Name") || "Microsoft 365";
    const activeUsers = num(col(row, "Active Users"));
    const inactiveUsers = num(col(row, "Inactive Users"));
    const totalUsers = activeUsers + inactiveUsers;
    const inactivePercent = totalUsers > 0 ? Math.round((inactiveUsers / totalUsers) * 100) : 0;
    return [
      {
        service,
        activeUsers,
        inactiveUsers,
        totalUsers,
        inactivePercent,
        recommendation:
          inactiveUsers > 0
            ? "Review inactive users and remove stale access if no longer needed."
            : "No inactive users detected for this service.",
      },
    ];
  }
  return services.map((service) => {
    const activeUsers = num(serviceCell(row, service, "Active"));
    const inactiveUsers = num(serviceCell(row, service, "Inactive"));
    const totalUsers = activeUsers + inactiveUsers;
    const inactivePercent = totalUsers > 0 ? Math.round((inactiveUsers / totalUsers) * 100) : 0;
    return {
      service,
      activeUsers,
      inactiveUsers,
      totalUsers,
      inactivePercent,
      recommendation:
        inactiveUsers > 0
          ? "Review inactive users and remove stale access if no longer needed."
          : "No inactive users detected for this service.",
    };
  });
}

export async function fetchCsv(transport: GraphTransport, path: string): Promise<CsvRow[]> {
  if (!transport.getCsv) throw new Error("This report requires CSV transport, which is unavailable.");
  return (await transport.getCsv(path)).rows;
}
