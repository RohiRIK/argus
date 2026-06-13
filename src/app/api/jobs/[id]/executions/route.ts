import { executionsDao } from "@/db/dao/executions";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/jobs/:id/executions — execution history for a job. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const limit = Number(new URL(req.url).searchParams.get("limit") ?? 50);
    const rows = executionsDao.forJob(params.id, Number.isFinite(limit) ? limit : 50);
    return ok(rows, { total: rows.length });
  } catch (err) {
    return fail(err);
  }
}
