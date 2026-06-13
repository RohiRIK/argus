import { jobsDao } from "@/db/dao/jobs";
import { runJob } from "@/services/executor";
import { settingsDao } from "@/db/dao/settings";
import { vaultService } from "@/services/vault/vault";
import { ok, fail } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** POST /api/jobs/:id/run — trigger an immediate execution (PRD "Run Now"). */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const job = jobsDao.findById(params.id);
    if (!job) throw new NotFoundError(`Job ${params.id} not found`);

    const execution = await runJob(job, {
      tenantName: vaultService.get("tenantId") ?? "tenant",
      canSendEmail: settingsDao.get().permissionStatus === "ok",
    });
    return ok(execution);
  } catch (err) {
    return fail(err);
  }
}
