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
  language: z.enum(["en", "he"]).optional(),
  permissionStatus: z.enum(["ok", "missing", "error"]).optional(),
});

export const vaultInputSchema = z.record(z.string().min(1), z.string());

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
