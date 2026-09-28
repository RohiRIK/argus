import type { ConditionalRules } from "@/db/schema";

export interface ConditionContext {
  count: number;
  previousCount: number | null;
  isAnomaly: boolean;
  newItemCount: number;
  /** Current value of the rule's named metric. `undefined` = metric absent from this report (metric_delta). */
  metricValue?: number;
  /** Same metric on the prior successful run. `null` = no prior (first run). */
  previousMetricValue?: number | null;
}

export interface ConditionResult {
  send: boolean;
  /** Human-readable reason, used for suppression logs (PRD §4.4). */
  reason: string;
}

/**
 * Evaluate a job's conditional-send rule against the current execution context.
 * Returns whether to send and a reason string for the execution log.
 */
export function evaluateCondition(rule: ConditionalRules, ctx: ConditionContext): ConditionResult {
  switch (rule.mode) {
    case "always":
      return { send: true, reason: "Always send" };

    case "count_gt": {
      const threshold = rule.threshold ?? 0;
      return ctx.count > threshold
        ? { send: true, reason: `count (${ctx.count}) above threshold (${threshold})` }
        : { send: false, reason: `count (${ctx.count}) below threshold (${threshold})` };
    }

    case "count_changed": {
      if (ctx.previousCount === null) return { send: true, reason: "first run — no prior count" };
      return ctx.count !== ctx.previousCount
        ? { send: true, reason: `count changed (${ctx.previousCount} → ${ctx.count})` }
        : { send: false, reason: `count unchanged (${ctx.count})` };
    }

    case "anomaly":
      return ctx.isAnomaly
        ? { send: true, reason: "anomaly detected against baseline" }
        : { send: false, reason: "no anomaly detected against baseline" };

    case "new_items":
      return ctx.newItemCount > 0
        ? { send: true, reason: `${ctx.newItemCount} new item(s) since last run` }
        : { send: false, reason: "no new items since last run" };

    case "metric_delta": {
      const metric = rule.metric ?? "count";
      const mag = rule.delta ?? 0;
      const dir = rule.direction ?? "either";
      const cur = ctx.metricValue;
      // Metric not present in this report's output — fail safe (don't fire a delta
      // we can't compute), and say so for the log (FM1/AC7).
      if (cur === undefined) {
        return { send: false, reason: `metric "${metric}" not found in this report — delta not evaluated` };
      }
      const prev = ctx.previousMetricValue;
      // First run / no prior with this metric — record the baseline, don't alert (F5).
      if (prev === undefined || prev === null) {
        return { send: false, reason: `baseline recorded for "${metric}" (${cur}) — no prior run to compare` };
      }
      const change = cur - prev;
      const hit = dir === "drop" ? change <= -mag : dir === "rise" ? change >= mag : Math.abs(change) >= mag;
      const arrow = `${prev}→${cur}`;
      const signed = `${change >= 0 ? "+" : ""}${change}`;
      return hit
        ? { send: true, reason: `${metric} ${signed} (${arrow}) — ${dir} by ≥ ${mag}` }
        : { send: false, reason: `${metric} ${signed} (${arrow}) — under ${dir} threshold ${mag}` };
    }

    default:
      // Exhaustive guard — unknown rule modes fail safe to "send".
      return { send: true, reason: "unknown rule — sending by default" };
  }
}
