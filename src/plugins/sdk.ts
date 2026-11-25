import type { ReportPlugin } from "@/services/reports/types";

export const PLUGIN_API_VERSION = "argus.report/v1" as const;

export type ReportPluginInput<Row = Record<string, unknown>> = Omit<
  ReportPlugin<Row>,
  "apiVersion" | "source"
> & {
  apiVersion?: typeof PLUGIN_API_VERSION;
};

/**
 * Define a strongly-typed Argus report plugin (`argus.report/v1`).
 * Seals metadata lists so plugins cannot mutate shared scope declarations at runtime.
 */
export function defineReportPlugin<Row = Record<string, unknown>>(
  input: ReportPluginInput<Row>,
): ReportPlugin<Row> {
  return {
    ...input,
    apiVersion: input.apiVersion ?? PLUGIN_API_VERSION,
    source: "builtin",
    author: input.author ?? "Argus Official",
    requiredPermissions: Object.freeze([...input.requiredPermissions]) as string[],
    ...(input.tags ? { tags: Object.freeze([...input.tags]) as string[] } : {}),
    ...(input.metrics ? { metrics: Object.freeze([...input.metrics]) as string[] } : {}),
  };
}
