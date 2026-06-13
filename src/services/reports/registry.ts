import type { ReportDefinition } from "./types";
import { signInAnomaliesReport } from "./sign-in-anomalies";
import {
  riskyUsersReport,
  mfaRegistrationReport,
  licenseUtilizationReport,
  appSecretsExpiryReport,
} from "./catalog";

/**
 * Catalog registry. Adding a report = register it here (PRD §10). The
 * API/catalog reads from this map. Stored as ReportDefinition<object>: TS
 * method-parameter bivariance lets concrete row-typed defs register here.
 */
const REPORTS = new Map<string, ReportDefinition<object>>(
  [
    signInAnomaliesReport,
    riskyUsersReport,
    mfaRegistrationReport,
    licenseUtilizationReport,
    appSecretsExpiryReport,
  ].map((r) => [r.id, r as ReportDefinition<object>]),
);

export function getReport(id: string): ReportDefinition<object> | undefined {
  return REPORTS.get(id);
}

export function listReports(): ReportDefinition<object>[] {
  return [...REPORTS.values()];
}
