import { z } from "zod";
import {
  automationActionsDao,
  automationLogsDao,
  automationPoliciesDao,
} from "@/db/dao/automations";
import { enqueueAutomationRun } from "@/services/automations/engine";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const runBodySchema = z.object({
  mode: z.enum(["audit", "enforce"]).optional(),
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
