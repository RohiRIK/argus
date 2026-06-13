import { jobsDao } from "@/db/dao/jobs";
import { ok, fail } from "@/lib/api";
import { parseBody, jobUpdateSchema } from "@/lib/validation";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const job = jobsDao.findById(params.id);
    if (!job) throw new NotFoundError(`Job ${params.id} not found`);
    return ok(job);
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const patch = await parseBody(req, jobUpdateSchema);
    const updated = jobsDao.update(params.id, patch);
    if (!updated) throw new NotFoundError(`Job ${params.id} not found`);
    return ok(updated);
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    if (!jobsDao.findById(params.id)) throw new NotFoundError(`Job ${params.id} not found`);
    jobsDao.delete(params.id); // cascades executions/logs/baselines
    return ok({ deleted: params.id });
  } catch (err) {
    return fail(err);
  }
}
