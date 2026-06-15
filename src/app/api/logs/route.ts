import { logsDao } from "@/db/dao/executions";
import { ok, fail } from "@/lib/api";
import type { Log } from "@/db/schema";

export const dynamic = "force-dynamic";

/** GET /api/logs?executionId=&level=&from=&to= — filtered log query. */
export async function GET(req: Request) {
  try {
    const p = new URL(req.url).searchParams;
    const level = p.get("level");
    const rows = logsDao.query({
      executionId: p.get("executionId") ?? undefined,
      level: (level as Log["level"] | null) ?? undefined,
      from: p.get("from") ?? undefined,
      to: p.get("to") ?? undefined,
    });
    return ok(rows, { total: rows.length });
  } catch (err) {
    return fail(err);
  }
}
