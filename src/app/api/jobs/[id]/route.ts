import { jobsDao } from "@/db/dao/jobs";
import { activationDecision } from "@/services/job-readiness";
import { addOrReplaceJob, removeJob } from "@/services/scheduler";
import { ok, fail } from "@/lib/api";
import { parseBody, jobUpdateSchema } from "@/lib/validation";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

// Next 16: route params are async.
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const job = jobsDao.findById(id);
    if (!job) throw new NotFoundError(`Job ${id} not found`);
    return ok(job);
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const patch = await parseBody(req, jobUpdateSchema);
    const current = jobsDao.findById(id);
    if (!current) throw new NotFoundError(`Job ${id} not found`);
    // H4: activating (or editing an active job) must leave it deliverable; otherwise it is paused.
    const merged = { ...current, ...patch, id };
    const decision = activationDecision(merged.status, merged);
    const updated = jobsDao.update(id, { ...patch, status: decision.status });
    if (!updated) throw new NotFoundError(`Job ${id} not found`);
    addOrReplaceJob(id); // re-schedule with new params/schedule/status (AC-S2)
    return ok({ ...updated, blockers: decision.blockers });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!jobsDao.findById(id)) throw new NotFoundError(`Job ${id} not found`);
    jobsDao.delete(id); // cascades executions/logs/baselines
    removeJob(id); // stop firing the deleted job (AC-S2)
    return ok({ deleted: id });
  } catch (err) {
    return fail(err);
  }
}
