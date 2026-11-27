import { rollbackAutomationAction } from "@/services/automations/engine";
import { ok, fail } from "@/lib/api";
import { actorFrom, recordEnforceDecision } from "@/services/automations/safety";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ actionId: string }> };

/** POST /api/automations/actions/:actionId/rollback — undo a previously applied Graph mutation using its snapshot rollbackPayload. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { actionId } = await params;
    const result = await rollbackAutomationAction(actionId);
    recordEnforceDecision("automation.rollback", actorFrom(req), {
      actionId,
      policyId: result.run.policyId,
      runId: result.run.id,
    });
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
