import type { GraphTransport } from "@/services/graph/client";

export type ReportCategory = "identity" | "security" | "infrastructure" | "custom";
export type RecommendedSchedule = "hourly" | "daily" | "weekly";
export type PluginIconKey =
  | "entra"
  | "defender"
  | "conditional-access"
  | "purview"
  | "intune"
  | "exchange"
  | "teams"
  | "sharepoint"
  | "onedrive"
  | "licenses"
  | "credentials"
  | "groups"
  | "graph";
export type PluginDataSource = "graph-v1" | "graph-beta" | "usage-csv";

/** A built-in or plugin-provided report type from the Catalog (PRD §10). */
export interface ReportDefinition<Row = Record<string, unknown>> {
  /** Stable identifier stored on jobs.reportType. */
  id: string;
  name: string;
  category: ReportCategory;
  description: string;
  /** Graph permissions this report needs (read-only scopes enforced by plugin security). */
  requiredPermissions: string[];
  baselineSupport: boolean;
  /** Optional discovery tags (catalog search). */
  tags?: string[];
  /** Optional maturity; unset/missing is treated as stable in the catalog UI. */
  maturity?: "stable" | "preview";
  /** Plugin contract metadata (populated by `defineReportPlugin` & declarative loader). */
  apiVersion?: "argus.report/v1";
  version?: string;
  recommendedSchedule?: RecommendedSchedule;
  recommendedGroup?: string;
  usageConcealmentNote?: boolean;
  source?: "builtin" | "declarative";
  service?: string;
  icon?: PluginIconKey;
  dataSource?: PluginDataSource;
  metrics?: string[];
  author?: string;
  /** Fetch the raw rows via the injected transport. */
  fetch(transport: GraphTransport, params: Record<string, unknown>): Promise<Row[]>;
  /** Derive template variables from the fetched rows. */
  summarize(rows: Row[]): ReportSummary;
  /**
   * Stable identity for a summarized result row across runs (e.g. user id, app
   * id, sp id), used for row-level diff (spec-history-and-diff). Keyed off the
   * flat `summary.rows` entry, not the raw Graph row. When omitted, diff falls
   * back to a deterministic hash of the row's values.
   */
  rowKey?(row: Record<string, string | number>): string;
}

export interface ReportPlugin<Row = Record<string, unknown>> extends ReportDefinition<Row> {
  apiVersion: "argus.report/v1";
  version: string;
}

export interface ReportSummary {
  /** Primary metric the baseline + conditions key off. */
  count: number;
  /** Flat string variables injected into the template ({{key}}). */
  variables: Record<string, string | number>;
  /** Optional structured rows for table rendering. */
  rows?: Record<string, string | number>[];
}
