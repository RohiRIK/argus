import { z } from "zod";
import {
  automationActionsDao,
  automationLogsDao,
  automationPoliciesDao,
} from "@/db/dao/automations";
import { enqueueAutomationRun } from "@/services/automations/engine";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { actorFrom, assertEnforceAllowed, recordEnforceDecision } from "@/services/automations/safety";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const runBodySchema = z.object({
  mode: z.enum(["audit", "enforce"]).optional(),
  confirmEnforce: z.boolean().optional(),
});

/** POST /api/automations/:id/run — trigger an immediate Audit (Dry-Run) or Enforce execution. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const policy = automationPoliciesDao.findById(id);
    if (!policy) throw new NotFoundError(`Automation policy ${id} not found`);

    const raw = await req.json().catch(() => ({}));
    const parsed = runBodySchema.safeParse(raw);
    const modeOverride = parsed.success ? parsed.data.mode : undefined;

    // A one-off enforce run of an audit-mode policy needs the same review + confirmation
    // as switching it to enforce. Every manual enforce run is attributed to the user.
    const effectiveMode = modeOverride ?? policy.mode;
    if (effectiveMode === "enforce") {
      if (policy.mode !== "enforce") assertEnforceAllowed(policy, parsed.success ? parsed.data.confirmEnforce : undefined);
      recordEnforceDecision("automation.enforce_run", actorFrom(req), { policyId: id, policyName: policy.name });
    }

    const res = await enqueueAutomationRun(policy, {
      modeOverride,
      trigger: "manual",
    });
    if (!res.ran || !res.run) {
      throw new ConflictError(`Automation policy "${policy.name}" is already running`);
    }

    return ok({
      run: res.run,
      actions: automationActionsDao.forRun(res.run.id),
      logs: automationLogsDao.forRun(res.run.id),
    });
  } catch (err) {
    return fail(err);
  }
}
