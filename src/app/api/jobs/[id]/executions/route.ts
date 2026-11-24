import { executionsDao } from "@/db/dao/executions";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/jobs/:id/executions — execution history for a job. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const raw = Number(new URL(req.url).searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(raw) ? Math.min(500, Math.max(1, Math.floor(raw))) : 50;
    const rows = executionsDao.forJob(id, limit);
    return ok(rows, { total: rows.length });
  } catch (err) {
    return fail(err);
  }
}
