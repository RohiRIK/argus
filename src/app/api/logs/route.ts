import { LOG_PAGE_MAX } from "@/db/dao/executions";
import { activityLogsDao, type ActivityLogFilters, type LogSourceFilter } from "@/db/dao/activity-logs";
import { ok, fail } from "@/lib/api";
import { decodeCursor, encodeCursor } from "@/lib/cursor";
import { ValidationError } from "@/lib/errors";
import { logEntryHref } from "@/lib/work-items";
import type { Log } from "@/db/schema";

export const dynamic = "force-dynamic";

const LEVELS: readonly Log["level"][] = ["info", "warning", "error"];
const SOURCES: readonly LogSourceFilter[] = ["all", "report", "automation"];

/**
 * GET /api/logs?source=&executionId=&runId=&level=&from=&to=&limit=&cursor= — report
 * and automation logs merged newest first, keyset-paginated. `source` is `all`
 * (default), `report` or `automation`. `limit` defaults to (and is capped at) 500.
 * Each entry carries `source` and `href` (the execution or automation run it
 * belongs to). `meta.total` is the real count of matching rows; `meta.nextCursor`
 * (null on the last page) is passed back as `cursor` to fetch the next page.
 */
export async function GET(req: Request) {
  try {
    const p = new URL(req.url).searchParams;
    const level = p.get("level") || undefined;
    if (level !== undefined && !LEVELS.includes(level as Log["level"])) {
      throw new ValidationError("Invalid level", { level: `Must be one of ${LEVELS.join(", ")}` });
    }
    const source = p.get("source") || "all";
    if (!SOURCES.includes(source as LogSourceFilter)) {
      throw new ValidationError("Invalid source", { source: `Must be one of ${SOURCES.join(", ")}` });
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

    const filters: ActivityLogFilters = {
      source: source as LogSourceFilter,
      executionId: p.get("executionId") || undefined,
      runId: p.get("runId") || undefined,
      level: level as Log["level"] | undefined,
      from: p.get("from") || undefined,
      to: p.get("to") || undefined,
    };
    const page = activityLogsDao.page(filters, { limit, after });
    return ok(
      page.rows.map((r) => ({ ...r, href: logEntryHref(r) })),
      {
        total: activityLogsDao.count(filters),
        limit,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
      },
    );
  } catch (err) {
    return fail(err);
  }
}
