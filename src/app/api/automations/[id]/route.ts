import { automationPoliciesDao, automationRunsDao } from "@/db/dao/automations";
import { getAutomation } from "@/services/automations/registry";
import {
  addOrReplaceAutomationPolicy,
  removeAutomationPolicy,
} from "@/services/scheduler";
import { automationPolicyUpdateSchema, parseBody } from "@/lib/validation";
import { NotFoundError } from "@/lib/errors";
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
    if (!automationPoliciesDao.findById(id)) {
      throw new NotFoundError(`Automation policy ${id} not found`);
    }
    const patch = await parseBody(req, automationPolicyUpdateSchema);
    const updated = automationPoliciesDao.update(id, patch);
    addOrReplaceAutomationPolicy(id);
    return ok(updated);
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
