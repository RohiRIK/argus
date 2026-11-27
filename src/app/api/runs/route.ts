import { z } from "zod";
import {
  activityRunsDao,
  RUN_PAGE_MAX,
  type ActivityRunFilters,
} from "@/db/dao/activity-runs";
import { ok, fail } from "@/lib/api";
import { decodeCursor, encodeCursor } from "@/lib/cursor";
import { ValidationError } from "@/lib/errors";
import { executionHref, automationRunHref } from "@/lib/work-items";

export const dynamic = "force-dynamic";

const Query = z.object({
  source: z.enum(["all", "report", "automation"]).default("all"),
  outcome: z.enum(["all", "ok", "attention", "failed"]).default("all"),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(RUN_PAGE_MAX).default(50),
  cursor: z.string().min(1).optional(),
});

/**
 * GET /api/runs?source=&outcome=&from=&to=&limit=&cursor= — report executions and
 * automation runs merged newest first, keyset-paginated. `outcome` groups statuses
 * across both sources: ok (success), attention (warning, drift, suppressed, halted),
 * failed (failed, interrupted). Each row carries `href` to its detail page.
 */
export async function GET(req: Request) {
  try {
    const raw = Object.fromEntries(
      [...new URL(req.url).searchParams.entries()].filter(([, v]) => v !== ""),
    );
    const parsed = Query.safeParse(raw);
    if (!parsed.success) {
      const fields = Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message]));
      throw new ValidationError("Invalid query", fields);
    }
    const q = parsed.data;
    const filters: ActivityRunFilters = { source: q.source, outcome: q.outcome, from: q.from, to: q.to };
    const page = activityRunsDao.page(filters, { limit: q.limit, after: q.cursor ? decodeCursor(q.cursor) : null });
    return ok(
      page.rows.map((r) => ({ ...r, href: r.source === "report" ? executionHref(r.id) : automationRunHref(r.id) })),
      {
        total: activityRunsDao.count(filters),
        limit: q.limit,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
      },
    );
  } catch (err) {
    return fail(err);
  }
}
