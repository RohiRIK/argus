import { ok, fail } from "@/lib/api";
import { alertIncidentsDao } from "@/db/dao/alert-incidents";

export const dynamic = "force-dynamic";

/** GET /api/alerts/incidents — recent failure-alert incidents and their notification attempts (H7). */
export async function GET(req: Request) {
  try {
    const limit = Math.min(200, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 50));
    const rows = alertIncidentsDao.recent(limit);
    return ok(rows, { total: rows.length });
  } catch (err) {
    return fail(err);
  }
}
