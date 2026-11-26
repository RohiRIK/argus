import { jobsDao } from "@/db/dao/jobs";
import { enqueueRun } from "@/services/run-queue";
import { ok, fail } from "@/lib/api";
import { ConflictError, NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/:id/run — trigger an immediate execution (PRD "Run Now").
 * Uses the same delivery preflight as scheduled runs (H3): for the same job and
 * capability state, Run Now and the scheduler make the same send decision.
 * A paused job runs as a diagnostic: everything executes, but no email is sent.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const job = jobsDao.findById(id);
    if (!job) throw new NotFoundError(`Job ${id} not found`);

    const result = await enqueueRun(job, {
      trigger: "manual",
      deliver: job.status === "active",
    });
    if (!result.ran || !result.execution) {
      throw new ConflictError(`Job "${job.name}" is already running`);
    }
    return ok(result.execution);
  } catch (err) {
    return fail(err);
  }
}
