import { jobsDao } from "@/db/dao/jobs";
import { runJob } from "@/services/executor";
import { settingsDao } from "@/db/dao/settings";
import { ok, fail } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** POST /api/jobs/:id/run — trigger an immediate execution (PRD "Run Now"). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const job = jobsDao.findById(id);
    if (!job) throw new NotFoundError(`Job ${id} not found`);

    const execution = await runJob(job, {
      // Don't pass the tenant ID GUID as the org name — the templates fall back to a friendly label.
      canSendEmail: settingsDao.get().permissionStatus === "ok",
    });
    return ok(execution);
  } catch (err) {
    return fail(err);
  }
}
