import { z } from "zod";
import { ValidationError } from "./errors";
import { isValidCron } from "./cron";

export const conditionalRulesSchema = z.object({
  mode: z.enum(["always", "count_gt", "count_changed", "anomaly", "new_items"]),
  threshold: z.number().int().nonnegative().optional(),
});

const jobBaseSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(""),
  reportType: z.string().min(1),
  params: z.record(z.unknown()).default({}),
  scheduleType: z.enum(["preset", "cron"]),
  schedulePreset: z.string().nullable().optional(),
  cronExpression: z.string().nullable().optional(),
  templateId: z.string().nullable().optional(),
  recipients: z.array(z.string().email()).default([]),
  conditionalRules: conditionalRulesSchema.default({ mode: "always" }),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  status: z.enum(["active", "disabled"]).default("active"),
});

export const jobInputSchema = jobBaseSchema
  .refine((j) => j.scheduleType !== "preset" || Boolean(j.schedulePreset), {
    message: "schedulePreset is required when scheduleType is 'preset'",
    path: ["schedulePreset"],
  })
  .refine((j) => j.scheduleType !== "cron" || (j.cronExpression && isValidCron(j.cronExpression)), {
    message: "a valid cronExpression is required when scheduleType is 'cron'",
    path: ["cronExpression"],
  });

/** Partial schema for PUT (any subset of fields; no cross-field refinement). */
export const jobUpdateSchema = jobBaseSchema.partial();

export type JobInput = z.infer<typeof jobInputSchema>;

export const settingsInputSchema = z.object({
  globalRecipients: z.array(z.string().email()).optional(),
  adminContacts: z.array(z.string().email()).optional(),
  language: z.enum(["en", "he"]).optional(),
  permissionStatus: z.enum(["ok", "missing", "error"]).optional(),
  timezone: z.string().min(1).max(64).optional(),
  retentionDays: z.number().int().min(7).max(3650).optional(),
  fromAddress: z.string().email().nullable().optional(),
  replyTo: z.string().email().nullable().optional(),
  // Failure alerts: notify admins after N consecutive failures (0 = disabled).
  alertThreshold: z.number().int().min(0).max(50).optional(),
});

export const vaultInputSchema = z.record(z.string().min(1), z.string());

export const webhookInputSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().url(),
  secret: z.string().nullable().optional(),
  includeFullHtml: z.boolean().default(true),
  payloadTemplate: z.string().nullable().optional(),
  enabled: z.boolean().default(true),
});
export const webhookUpdateSchema = webhookInputSchema.partial();

export const templateInputSchema = z.object({
  name: z.string().min(1).max(120),
  reportType: z.string().default("generic"),
  subject: z.string().min(1),
  htmlBody: z.string().min(1),
  textBody: z.string().nullable().optional(),
  isDefault: z.boolean().default(false),
  language: z.enum(["en", "he"]).default("en"),
});

/** Parse a request JSON body against a schema, throwing ValidationError on failure. */
export async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) fields[issue.path.join(".") || "_"] = issue.message;
    throw new ValidationError("Validation failed", fields);
  }
  return result.data;
}
