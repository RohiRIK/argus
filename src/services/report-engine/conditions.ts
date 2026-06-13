import type { ConditionalRules } from "@/db/schema";

export interface ConditionContext {
  count: number;
  previousCount: number | null;
  isAnomaly: boolean;
  newItemCount: number;
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

    default:
      // Exhaustive guard — unknown rule modes fail safe to "send".
      return { send: true, reason: "unknown rule — sending by default" };
  }
}
