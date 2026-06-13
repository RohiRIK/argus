import { jobsDao } from "@/db/dao/jobs";
import { resolveCron } from "@/services/scheduler";
import { nextRuns } from "@/lib/cron";
import { ok, fail } from "@/lib/api";
import { NotFoundError, ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** GET /api/jobs/:id/schedule-preview — next 5 run times (PRD §4.1). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const job = jobsDao.findById(id);
    if (!job) throw new NotFoundError(`Job ${id} not found`);
    const expr = resolveCron(job);
    if (!expr) throw new ValidationError("Job has no valid schedule");
    return ok({ cron: expr, nextRuns: nextRuns(expr, 5).map((d) => d.toISOString()) });
  } catch (err) {
    return fail(err);
  }
}
