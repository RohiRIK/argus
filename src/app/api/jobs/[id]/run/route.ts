import { jobsDao } from "@/db/dao/jobs";
import { enqueueRun } from "@/services/run-queue";
import { settingsDao } from "@/db/dao/settings";
import { ok, fail } from "@/lib/api";
import { ConflictError, NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** POST /api/jobs/:id/run — trigger an immediate execution (PRD "Run Now"). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const job = jobsDao.findById(id);
    if (!job) throw new NotFoundError(`Job ${id} not found`);

    const result = await enqueueRun(job, {
      // Don't pass the tenant ID GUID as the org name — the templates fall back to a friendly label.
      canSendEmail: settingsDao.get().permissionStatus === "ok",
    });
    if (!result.ran || !result.execution) {
      throw new ConflictError(`Job "${job.name}" is already running`);
    }
    return ok(result.execution);
  } catch (err) {
    return fail(err);
  }
}
