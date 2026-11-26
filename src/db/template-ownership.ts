import { eq, isNull } from "drizzle-orm";
import { getDb } from "./client";
import { templates } from "./schema";
import { isKnownDefaultContent, templateContentHash } from "@/services/report-engine/managed-template";

/**
 * Backfill template ownership for rows that predate migration 0016 (or were
 * restored from an older backup): `managed IS NULL`.
 *
 *  - custom clones (`is_default = 0`) → operator-owned;
 *  - seeded defaults whose subject/html/text are all current-or-legacy Argus
 *    defaults → managed, `sourceHash` = hash of their current content (so the
 *    next seed upgrades legacy ones to the latest default);
 *  - seeded defaults with any edited field → operator-owned (never auto-upgraded).
 *
 * Idempotent; runs after every `runMigrations()` and at the start of `seed()`.
 */
export function classifyTemplateOwnership(): { managed: number; operatorOwned: number } {
  const db = getDb();
  let managed = 0;
  let operatorOwned = 0;
  db.transaction((tx) => {
    const rows = tx.select().from(templates).where(isNull(templates.managed)).all();
    for (const t of rows) {
      const content = { subject: t.subject, htmlBody: t.htmlBody, textBody: t.textBody };
      if (t.isDefault && isKnownDefaultContent(content)) {
        tx.update(templates)
          .set({ managed: true, sourceHash: templateContentHash(content) })
          .where(eq(templates.id, t.id))
          .run();
        managed++;
      } else {
        tx.update(templates).set({ managed: false }).where(eq(templates.id, t.id)).run();
        operatorOwned++;
      }
    }
  });
  return { managed, operatorOwned };
}
