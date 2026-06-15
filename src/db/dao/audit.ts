import { desc } from "drizzle-orm";
import { getDb } from "../client";
import { audit, type Audit, type NewAudit } from "../schema";

/** Append-only audit log for privileged actions (e.g. programmatic permission grants, GRANT-6). */
export const auditDao = {
  record(entry: Pick<NewAudit, "action" | "outcome"> & Partial<Pick<NewAudit, "provider" | "detail">>): Audit {
    return getDb()
      .insert(audit)
      .values({
        id: crypto.randomUUID(),
        action: entry.action,
        provider: entry.provider ?? null,
        outcome: entry.outcome,
        detail: entry.detail ?? {},
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get();
  },

  /** Newest-first, capped. */
  list(limit = 50): Audit[] {
    return getDb().select().from(audit).orderBy(desc(audit.createdAt)).limit(limit).all();
  },
};
