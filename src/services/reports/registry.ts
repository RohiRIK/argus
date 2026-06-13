import type { ReportDefinition } from "./types";
import { signInAnomaliesReport } from "./sign-in-anomalies";

/**
 * Catalog registry. Adding a report = register it here (PRD §10 lists the full
 * set; MVP ships the first). The API/catalog reads from this map.
 */
// Stored as ReportDefinition<object>: TS method-parameter bivariance lets a
// concrete ReportDefinition<SignIn> register here without an unsafe cast.
const REPORTS = new Map<string, ReportDefinition<object>>([
  [signInAnomaliesReport.id, signInAnomaliesReport],
]);

export function getReport(id: string): ReportDefinition<object> | undefined {
  return REPORTS.get(id);
}

export function listReports(): ReportDefinition<object>[] {
  return [...REPORTS.values()];
}
