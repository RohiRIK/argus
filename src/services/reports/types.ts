import type { GraphTransport } from "@/services/graph/client";

/** A built-in report type from the Catalog (PRD §10). */
export interface ReportDefinition<Row = Record<string, unknown>> {
  /** Stable identifier stored on jobs.reportType. */
  id: string;
  name: string;
  category: "identity" | "security" | "infrastructure" | "custom";
  description: string;
  /** Graph permissions this report needs (for the catalog UI). */
  requiredPermissions: string[];
  baselineSupport: boolean;
  /** Fetch the raw rows via the injected transport. */
  fetch(transport: GraphTransport, params: Record<string, unknown>): Promise<Row[]>;
  /** Derive template variables from the fetched rows. */
  summarize(rows: Row[]): ReportSummary;
}

export interface ReportSummary {
  /** Primary metric the baseline + conditions key off. */
  count: number;
  /** Flat string variables injected into the template ({{key}}). */
  variables: Record<string, string | number>;
  /** Optional structured rows for table rendering. */
  rows?: Record<string, string | number>[];
}
