import { executionsDao } from "@/db/dao/executions";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/jobs/:id/executions — execution history for a job. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const limit = Number(new URL(req.url).searchParams.get("limit") ?? 50);
    const rows = executionsDao.forJob(id, Number.isFinite(limit) ? limit : 50);
    return ok(rows, { total: rows.length });
  } catch (err) {
    return fail(err);
  }
}
