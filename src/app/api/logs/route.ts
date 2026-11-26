import { logsDao, LOG_PAGE_MAX, type LogFilters } from "@/db/dao/executions";
import { ok, fail } from "@/lib/api";
import { decodeCursor, encodeCursor } from "@/lib/cursor";
import { ValidationError } from "@/lib/errors";
import type { Log } from "@/db/schema";

export const dynamic = "force-dynamic";

const LEVELS: readonly Log["level"][] = ["info", "warning", "error"];

/**
 * GET /api/logs?executionId=&level=&from=&to=&limit=&cursor= — filtered log query,
 * newest first, keyset-paginated. `limit` defaults to (and is capped at) 500.
 * `meta.total` is the real count of matching rows; `meta.nextCursor` (null on the
 * last page) is passed back as `cursor` to fetch the next page.
 */
export async function GET(req: Request) {
  try {
    const p = new URL(req.url).searchParams;
    const level = p.get("level") || undefined;
    if (level !== undefined && !LEVELS.includes(level as Log["level"])) {
      throw new ValidationError("Invalid level", { level: `Must be one of ${LEVELS.join(", ")}` });
    }
    const rawLimit = p.get("limit");
    let limit = LOG_PAGE_MAX;
    if (rawLimit !== null && rawLimit !== "") {
      const n = Number(rawLimit);
      if (!Number.isFinite(n)) throw new ValidationError("Invalid limit", { limit: "Must be a number" });
      limit = Math.min(LOG_PAGE_MAX, Math.max(1, Math.floor(n)));
    }
    const rawCursor = p.get("cursor");
    const after = rawCursor ? decodeCursor(rawCursor) : null;

    const filters: LogFilters = {
      executionId: p.get("executionId") || undefined,
      level: level as Log["level"] | undefined,
      from: p.get("from") || undefined,
      to: p.get("to") || undefined,
    };
    const page = logsDao.page(filters, { limit, after });
    return ok(page.rows, {
      total: logsDao.count(filters),
      limit,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
    });
  } catch (err) {
    return fail(err);
  }
}
