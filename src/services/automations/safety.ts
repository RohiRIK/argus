import type { AutomationPolicy } from "@/db/schema";
import { automationRunsDao } from "@/db/dao/automations";
import { auditDao } from "@/db/dao/audit";
import { ValidationError } from "@/lib/errors";
import { USER_HEADER } from "@/lib/auth/access";

/**
 * Guardrails for automations that change the tenant.
 *
 * - New policies always start in audit (what-if) mode.
 * - A policy can be switched to enforce (or run once in enforce) only after an
 *   audit run of its CURRENT configuration finished (success or drift found),
 *   and only with an explicit `confirmEnforce: true`. The switch is audited
 *   with the signed-in user.
 * - Changing the params of an enforcing policy puts it back into audit mode, so
 *   a new configuration is always previewed before it changes anything.
 */

export const ENFORCE_CONFIRM_FIELD = "confirmEnforce";

/** Who is making this request (set by the proxy from the session); "unknown" in tests/scripts. */
export function actorFrom(req: Request): string {
  return req.headers.get(USER_HEADER) ?? "unknown";
}

/** The latest finished audit run of this configuration, if any. */
export function lastAuditSinceChange(policy: Pick<AutomationPolicy, "id" | "updatedAt">) {
  return automationRunsDao
    .forPolicy(policy.id, 100)
    .find(
      (r) =>
        r.mode === "audit" &&
        (r.status === "success" || r.status === "drift_detected") &&
        r.startedAt >= policy.updatedAt,
    );
}

/** Throw unless this policy may run in enforce mode now. */
export function assertEnforceAllowed(
  policy: Pick<AutomationPolicy, "id" | "name" | "updatedAt">,
  confirmed: unknown,
): void {
  if (!lastAuditSinceChange(policy)) {
    throw new ValidationError(
      `Run "${policy.name}" in audit mode first and review the planned changes. Enforce is available after an audit run of the current settings.`,
    );
  }
  if (confirmed !== true) {
    throw new ValidationError(
      `Enforce makes real changes in your tenant. Confirm with "${ENFORCE_CONFIRM_FIELD}": true.`,
      { [ENFORCE_CONFIRM_FIELD]: "Required to enable enforce" },
    );
  }
}

export function recordEnforceDecision(
  action: "automation.enforce_enabled" | "automation.enforce_run" | "automation.enforce_disabled" | "automation.rollback",
  actor: string,
  detail: Record<string, unknown>,
): void {
  auditDao.record({ action, provider: "microsoft365-automation", outcome: "success", detail: { ...detail, actor } });
}
