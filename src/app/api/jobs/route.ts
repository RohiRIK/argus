import { jobsDao } from "@/db/dao/jobs";
import { executionsDao } from "@/db/dao/executions";
import { addOrReplaceJob } from "@/services/scheduler";
import { ok, fail } from "@/lib/api";
import { parseBody, jobInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** GET /api/jobs — list jobs with their latest execution summary. */
export async function GET() {
  try {
    const jobs = jobsDao.findAll().map((job) => ({
      ...job,
      lastExecution: executionsDao.forJob(job.id, 1)[0] ?? null,
    }));
    return ok(jobs, { total: jobs.length });
  } catch (err) {
    return fail(err);
  }
}

/** POST /api/jobs — create a job. */
export async function POST(req: Request) {
  try {
    const input = await parseBody(req, jobInputSchema);
    const created = jobsDao.create(input);
    addOrReplaceJob(created.id); // pick up the new job without a restart (AC-S2)
    return ok(created);
  } catch (err) {
    return fail(err);
  }
}
