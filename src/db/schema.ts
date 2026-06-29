import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Argus schema (PRD §7). Conventions:
 * - PKs are app-generated UUIDv4 strings.
 * - JSON columns are `text({ mode: "json" })` with explicit `$type`.
 * - Timestamps are ISO-8601 UTC strings; created/updated default to now.
 * - `executions` and `logs` are append-only.
 */

const nowIso = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export type Recipients = string[];
export type Tags = string[];
export type ConditionalRules = {
  mode: "always" | "count_gt" | "count_changed" | "anomaly" | "new_items";
  threshold?: number;
};

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  reportType: text("report_type").notNull(),
  params: text("params", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  scheduleType: text("schedule_type", { enum: ["preset", "cron"] }).notNull(),
  schedulePreset: text("schedule_preset"),
  cronExpression: text("cron_expression"),
  templateId: text("template_id").references(() => templates.id),
  recipients: text("recipients", { mode: "json" }).$type<Recipients>().notNull().default([]),
  conditionalRules: text("conditional_rules", { mode: "json" })
    .$type<ConditionalRules>()
    .notNull()
    .default({ mode: "always" }),
  tags: text("tags", { mode: "json" }).$type<Tags>().notNull().default([]),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  // When set and in the future, the scheduler skips this job's fires until it passes (auto-resume).
  snoozedUntil: text("snoozed_until"),
  createdAt: text("created_at").notNull().default(nowIso),
  updatedAt: text("updated_at").notNull().default(nowIso),
});

export const executions = sqliteTable("executions", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["success", "warning", "failed", "suppressed"] }).notNull(),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
  recordsProcessed: integer("records_processed").notNull().default(0),
  graphApiLatencyMs: integer("graph_api_latency_ms").notNull().default(0),
  errorMessage: text("error_message"),
  outputHtml: text("output_html"),
  emailSent: integer("email_sent", { mode: "boolean" }).notNull().default(false),
  emailRecipients: text("email_recipients", { mode: "json" }).$type<Recipients>(),
  suppressionReason: text("suppression_reason"),
  baselineSnapshot: text("baseline_snapshot", { mode: "json" }).$type<Record<string, number>>(),
  webhookDelivered: integer("webhook_delivered", { mode: "boolean" }).notNull().default(false),
  webhookError: text("webhook_error"),
  createdAt: text("created_at").notNull().default(nowIso),
}, (t) => ({
  // Hot paths: executionsDao.forJob (by job, newest first) + recent feed (AC-DB2).
  jobStarted: index("idx_executions_job_started").on(t.jobId, t.startedAt),
  started: index("idx_executions_started").on(t.startedAt),
}));

export const logs = sqliteTable("logs", {
  id: text("id").primaryKey(),
  executionId: text("execution_id")
    .notNull()
    .references(() => executions.id, { onDelete: "cascade" }),
  level: text("level", { enum: ["info", "warning", "error"] }).notNull(),
  message: text("message").notNull(),
  timestamp: text("timestamp").notNull().default(nowIso),
}, (t) => ({
  // logsDao.forExecution (by execution, time-ordered) + logsDao.query (AC-DB2).
  execution: index("idx_logs_execution").on(t.executionId, t.timestamp),
  timestamp: index("idx_logs_timestamp").on(t.timestamp),
}));

/**
 * Per-execution snapshot of a report's structured result rows, keyed by a stable
 * row identity (spec-history-and-diff). Enables true row-level diff against the
 * prior run (added/removed identities) instead of count arithmetic. Append-only;
 * pruned on the same retention window as baselines. Only written when a report
 * returns `summary.rows`.
 */
export const executionRows = sqliteTable("execution_rows", {
  id: text("id").primaryKey(),
  executionId: text("execution_id")
    .notNull()
    .references(() => executions.id, { onDelete: "cascade" }),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  rowKey: text("row_key").notNull(),
  rowData: text("row_data", { mode: "json" }).$type<Record<string, string | number>>().notNull(),
  createdAt: text("created_at").notNull().default(nowIso),
}, (t) => ({
  // diff: latest prior snapshot's keys for a job, newest first; prune by age.
  jobCreated: index("idx_execution_rows_job_created").on(t.jobId, t.createdAt),
  execution: index("idx_execution_rows_execution").on(t.executionId),
}));

export const baselines = sqliteTable("baselines", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  metricName: text("metric_name").notNull(),
  metricValue: real("metric_value").notNull(),
  windowDays: integer("window_days").notNull().default(7),
  calculatedAt: text("calculated_at").notNull().default(nowIso),
}, (t) => ({
  // baselinesDao.history (job + metric, newest first) and prune (AC-DB2).
  jobMetricCalc: index("idx_baselines_job_metric_calc").on(t.jobId, t.metricName, t.calculatedAt),
}));

export const templates = sqliteTable("templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  reportType: text("report_type").notNull().default("generic"),
  subject: text("subject").notNull(),
  htmlBody: text("html_body").notNull(),
  textBody: text("text_body"), // plain-text alternative (multipart email)
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  language: text("language", { enum: ["en", "he"] }).notNull().default("en"),
});

export const templateVersions = sqliteTable("template_versions", {
  id: text("id").primaryKey(),
  templateId: text("template_id")
    .notNull()
    .references(() => templates.id, { onDelete: "cascade" }),
  version: integer("version").notNull(), // 1-based, monotonic per template
  subject: text("subject").notNull(),
  htmlBody: text("html_body").notNull(),
  textBody: text("text_body"),
  createdAt: text("created_at").notNull().default(nowIso),
}, (t) => ({
  // templateVersionsDao.list (by template, newest version first).
  template: index("idx_template_versions_template").on(t.templateId, t.version),
}));

export const vault = sqliteTable("vault", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(), // AES-256-GCM ciphertext (base64)
  iv: text("iv").notNull(), // base64
  tag: text("tag").notNull(), // base64 auth tag
  updatedAt: text("updated_at").notNull().default(nowIso),
});

export const integrations = sqliteTable("integrations", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull().unique(),
  name: text("name").notNull(),
  status: text("status", { enum: ["connected", "disconnected", "error"] })
    .notNull()
    .default("disconnected"),
  config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  lastHealthCheck: text("last_health_check"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull().default(nowIso),
  updatedAt: text("updated_at").notNull().default(nowIso),
});

export const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey(),
  integrationId: text("integration_id")
    .notNull()
    .references(() => integrations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  secret: text("secret"),
  includeFullHtml: integer("include_full_html", { mode: "boolean" }).notNull().default(true),
  payloadTemplate: text("payload_template"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastDeliveryStatus: text("last_delivery_status", { enum: ["success", "failed"] }),
  lastDeliveryAt: text("last_delivery_at"),
  createdAt: text("created_at").notNull().default(nowIso),
  updatedAt: text("updated_at").notNull().default(nowIso),
});

export const settings = sqliteTable("settings", {
  id: text("id").primaryKey(), // singleton: "singleton"
  masterKeyHash: text("master_key_hash"),
  globalRecipients: text("global_recipients", { mode: "json" })
    .$type<Recipients>()
    .notNull()
    .default([]),
  adminContacts: text("admin_contacts", { mode: "json" })
    .$type<Recipients>()
    .notNull()
    .default([]),
  lastPermissionCheck: text("last_permission_check"),
  permissionStatus: text("permission_status", { enum: ["ok", "missing", "error"] })
    .notNull()
    .default("missing"),
  language: text("language", { enum: ["en", "he"] }).notNull().default("en"),
  timezone: text("timezone").notNull().default("UTC"),
  retentionDays: integer("retention_days").notNull().default(90),
  fromAddress: text("from_address"),
  replyTo: text("reply_to"),
  missingPermissions: text("missing_permissions", { mode: "json" }).$type<string[]>().notNull().default([]),
  // Failure alerts: notify adminContacts after this many consecutive failures (0 = off).
  alertThreshold: integer("alert_threshold").notNull().default(0),
  // When true (default), a report run with 0 items is suppressed instead of emailed.
  suppressEmptyReports: integer("suppress_empty_reports", { mode: "boolean" }).notNull().default(true),
});

export const audit = sqliteTable("audit", {
  id: text("id").primaryKey(),
  action: text("action").notNull(), // e.g. "permission_grant"
  provider: text("provider"), // e.g. "microsoft365"
  outcome: text("outcome", { enum: ["success", "partial", "error"] }).notNull(),
  detail: text("detail", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  createdAt: text("created_at").notNull().default(nowIso),
}, (t) => ({
  // auditDao.list (newest first).
  created: index("idx_audit_created").on(t.createdAt),
}));

// Inferred row types for use across services/DAOs.
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Execution = typeof executions.$inferSelect;
export type NewExecution = typeof executions.$inferInsert;
export type Log = typeof logs.$inferSelect;
export type NewLog = typeof logs.$inferInsert;
export type ExecutionRow = typeof executionRows.$inferSelect;
export type NewExecutionRow = typeof executionRows.$inferInsert;
export type Baseline = typeof baselines.$inferSelect;
export type Template = typeof templates.$inferSelect;
export type TemplateVersion = typeof templateVersions.$inferSelect;
export type VaultRow = typeof vault.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type NewWebhook = typeof webhooks.$inferInsert;
export type Settings = typeof settings.$inferSelect;
export type Audit = typeof audit.$inferSelect;
export type NewAudit = typeof audit.$inferInsert;
