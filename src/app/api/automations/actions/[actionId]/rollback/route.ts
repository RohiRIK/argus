import { rollbackAutomationAction } from "@/services/automations/engine";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ actionId: string }> };

/** POST /api/automations/actions/:actionId/rollback — undo a previously applied Graph mutation using its snapshot rollbackPayload. */
export async function POST(_req: Request, { params }: Ctx) {
  try {
    const { actionId } = await params;
    const result = await rollbackAutomationAction(actionId);
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
