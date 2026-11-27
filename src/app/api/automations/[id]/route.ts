import { requireRole } from "@/services/auth/identity";
import { automationPoliciesDao, automationRunsDao } from "@/db/dao/automations";
import { getAutomation } from "@/services/automations/registry";
import {
  addOrReplaceAutomationPolicy,
  removeAutomationPolicy,
} from "@/services/scheduler";
import { automationPolicyUpdateSchema, parseBody } from "@/lib/validation";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  ENFORCE_CONFIRM_FIELD,
  actorFrom,
  assertEnforceAllowed,
  recordEnforceDecision,
} from "@/services/automations/safety";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/automations/:id — policy detail + catalog metadata + recent runs. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const policy = automationPoliciesDao.findById(id);
    if (!policy) throw new NotFoundError(`Automation policy ${id} not found`);
    const def = getAutomation(policy.automationType);
    const runs = automationRunsDao.forPolicy(id, 30);
    return ok({
      policy,
      definition: def
        ? {
            id: def.id,
            name: def.name,
            category: def.category,
            riskLevel: def.riskLevel,
            description: def.description,
            requiredPermissions: def.requiredPermissions,
            paramSchema: def.paramSchema,
          }
        : null,
      runs,
    });
  } catch (err) {
    return fail(err);
  }
}

/** PUT /api/automations/:id — update policy settings (mode, params, schedule, status, maxActionsPerRun). */
export async function PUT(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const current = automationPoliciesDao.findById(id);
    if (!current) {
      throw new NotFoundError(`Automation policy ${id} not found`);
    }
    const raw = (await req.clone().json().catch(() => ({}))) as Record<string, unknown>;
    const patch = await parseBody(req, automationPolicyUpdateSchema);
    const actor = actorFrom(req);
    const paramsChanged = patch.params !== undefined && JSON.stringify(patch.params) !== JSON.stringify(current.params);

    let notice: string | undefined;
    if (patch.mode === "enforce" && current.mode !== "enforce") {
      requireRole(req, "admin", "switch an automation to Enforce");
      if (paramsChanged) {
        throw new ValidationError("Save the new settings and run an audit before enabling enforce.");
      }
      assertEnforceAllowed(current, raw[ENFORCE_CONFIRM_FIELD]);
      recordEnforceDecision("automation.enforce_enabled", actor, { policyId: id, policyName: current.name });
    } else if (paramsChanged && (patch.mode ?? current.mode) === "enforce") {
      // A new configuration is always previewed before it changes anything.
      patch.mode = "audit";
      notice = "Settings changed, so this automation is back in audit mode. Run an audit, then enable enforce again.";
      recordEnforceDecision("automation.enforce_disabled", actor, { policyId: id, reason: "params changed" });
    } else if (patch.mode === "audit" && current.mode === "enforce") {
      recordEnforceDecision("automation.enforce_disabled", actor, { policyId: id, policyName: current.name });
    }

    const updated = automationPoliciesDao.update(id, patch);
    addOrReplaceAutomationPolicy(id);
    return ok({ ...updated, ...(notice ? { notice } : {}) });
  } catch (err) {
    return fail(err);
  }
}

export { PUT as PATCH };

/** DELETE /api/automations/:id — delete policy and unschedule cron task. */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!automationPoliciesDao.findById(id)) {
      throw new NotFoundError(`Automation policy ${id} not found`);
    }
    removeAutomationPolicy(id);
    automationPoliciesDao.delete(id);
    return ok({ deleted: id });
  } catch (err) {
    return fail(err);
  }
}
