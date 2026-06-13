import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
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
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
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
});

export const logs = sqliteTable("logs", {
  id: text("id").primaryKey(),
  executionId: text("execution_id")
    .notNull()
    .references(() => executions.id, { onDelete: "cascade" }),
  level: text("level", { enum: ["info", "warning", "error"] }).notNull(),
  message: text("message").notNull(),
  timestamp: text("timestamp").notNull().default(nowIso),
});

export const baselines = sqliteTable("baselines", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  metricName: text("metric_name").notNull(),
  metricValue: real("metric_value").notNull(),
  windowDays: integer("window_days").notNull().default(7),
  calculatedAt: text("calculated_at").notNull().default(nowIso),
});

export const templates = sqliteTable("templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  reportType: text("report_type").notNull().default("generic"),
  subject: text("subject").notNull(),
  htmlBody: text("html_body").notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  language: text("language", { enum: ["en", "he"] }).notNull().default("en"),
});

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
  lastPermissionCheck: text("last_permission_check"),
  permissionStatus: text("permission_status", { enum: ["ok", "missing", "error"] })
    .notNull()
    .default("missing"),
  language: text("language", { enum: ["en", "he"] }).notNull().default("en"),
});

// Inferred row types for use across services/DAOs.
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Execution = typeof executions.$inferSelect;
export type NewExecution = typeof executions.$inferInsert;
export type Log = typeof logs.$inferSelect;
export type NewLog = typeof logs.$inferInsert;
export type Baseline = typeof baselines.$inferSelect;
export type Template = typeof templates.$inferSelect;
export type VaultRow = typeof vault.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type Settings = typeof settings.$inferSelect;
