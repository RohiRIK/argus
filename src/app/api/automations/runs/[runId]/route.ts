import {
  automationActionsDao,
  automationLogsDao,
  automationPoliciesDao,
  automationRunsDao,
} from "@/db/dao/automations";
import { NotFoundError } from "@/lib/errors";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ runId: string }> };

/** GET /api/automations/runs/:runId — inspect full run details, per-target pre/post JSON snapshots, and logs. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { runId } = await params;
    const run = automationRunsDao.findById(runId);
    if (!run) throw new NotFoundError(`Automation run ${runId} not found`);
    const policy = automationPoliciesDao.findById(run.policyId) ?? null;
    const actions = automationActionsDao.forRun(runId);
    const logs = automationLogsDao.forRun(runId);
    return ok({ run, policy, actions, logs });
  } catch (err) {
    return fail(err);
  }
}
