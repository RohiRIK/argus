import type { ReportDefinition } from "./types";
import { signInAnomaliesReport } from "./sign-in-anomalies";
import {
  riskyUsersReport,
  mfaRegistrationReport,
  licenseUtilizationReport,
  appSecretsExpiryReport,
} from "./catalog";
import {
  inactiveGuestUsersReport,
  securityAlertsDigestReport,
  dlpAlertsReport,
  conditionalAccessFailuresReport,
  deviceComplianceReport,
  auditLogSummaryReport,
  manualGraphQueryReport,
} from "./catalog-extra";
import {
  secureScoreReport,
  provisioningSummaryReport,
  riskyServicePrincipalsReport,
} from "./catalog-new";
import { csvReports } from "./catalog-csv";
import { tier3Reports } from "./catalog-tier3";

/**
 * Catalog registry — the full built-in report set (PRD §10). Adding a report =
 * register it here. Stored as ReportDefinition<object>: TS method-parameter
 * bivariance lets concrete row-typed defs register here.
 */
const REPORTS = new Map<string, ReportDefinition<object>>(
  [
    signInAnomaliesReport,
    riskyUsersReport,
    mfaRegistrationReport,
    inactiveGuestUsersReport,
    securityAlertsDigestReport,
    dlpAlertsReport,
    conditionalAccessFailuresReport,
    licenseUtilizationReport,
    appSecretsExpiryReport,
    deviceComplianceReport,
    auditLogSummaryReport,
    secureScoreReport,
    provisioningSummaryReport,
    riskyServicePrincipalsReport,
    ...csvReports,
    ...tier3Reports,
    manualGraphQueryReport,
  ].map((r) => [r.id, r as ReportDefinition<object>]),
);

export function getReport(id: string): ReportDefinition<object> | undefined {
  return REPORTS.get(id);
}

export function listReports(): ReportDefinition<object>[] {
  return [...REPORTS.values()];
}
