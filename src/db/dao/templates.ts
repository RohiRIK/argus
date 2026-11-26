import { eq, and, desc } from "drizzle-orm";
import { getDb, getRawDb } from "../client";
import { jobs, templates, templateVersions, type Template, type TemplateVersion } from "../schema";
import { listReports } from "@/services/reports/registry";
import {
  MANAGED_DEFAULT_CONTENT,
  MANAGED_DEFAULT_HASH,
  templateContentHash,
} from "@/services/report-engine/managed-template";

const nowIso = () => new Date().toISOString();

export const templatesDao = {
  findAll(): Template[] {
    return getDb().select().from(templates).all();
  },

  findById(id: string): Template | undefined {
    return getDb().select().from(templates).where(eq(templates.id, id)).get();
  },

  defaultFor(reportType: string, language: "en" | "he" = "en"): Template | undefined {
    return getDb()
      .select()
      .from(templates)
      .where(and(eq(templates.reportType, reportType), eq(templates.language, language), eq(templates.isDefault, true)))
      .get();
  },

  create(
    input: Omit<Template, "id" | "textBody" | "managed" | "sourceHash"> & {
      id?: string;
      textBody?: string | null;
      /** Omitted → NULL (unclassified; `classifyTemplateOwnership()` decides). */
      managed?: boolean | null;
      sourceHash?: string | null;
    },
  ): Template {
    return getDb()
      .insert(templates)
      .values({
        ...input,
        id: input.id ?? crypto.randomUUID(),
        textBody: input.textBody ?? null,
        managed: input.managed ?? null,
        sourceHash: input.sourceHash ?? null,
      })
      .returning()
      .get();
  },

  /**
   * Update a template, snapshotting its CURRENT content as a new version only when
   * subject/htmlBody/textBody actually changed. Runs in one transaction.
   *
   * `operatorEdit: true` (templates API/UI edits & version reverts) marks the row
   * operator-owned when its content changes, so seed never overwrites it.
   */
  update(
    id: string,
    patch: Partial<Omit<Template, "id">>,
    opts: { operatorEdit?: boolean } = {},
  ): Template | undefined {
    return getDb().transaction((tx) => {
      const current = tx.select().from(templates).where(eq(templates.id, id)).get();
      if (!current) return undefined;

      const contentChanged =
        (patch.subject !== undefined && patch.subject !== current.subject) ||
        (patch.htmlBody !== undefined && patch.htmlBody !== current.htmlBody) ||
        (patch.textBody !== undefined && patch.textBody !== current.textBody);

      if (contentChanged) {
        const row = getRawDb()
          .query("SELECT COALESCE(MAX(version), 0) + 1 AS next FROM template_versions WHERE template_id = ?")
          .get(id) as { next: number };
        tx.insert(templateVersions)
          .values({
            id: crypto.randomUUID(),
            templateId: id,
            version: row.next,
            subject: current.subject,
            htmlBody: current.htmlBody,
            textBody: current.textBody,
            createdAt: nowIso(),
          })
          .run();
      }
      const ownership = opts.operatorEdit && contentChanged ? { managed: false } : {};
      return tx
        .update(templates)
        .set({ ...patch, ...ownership })
        .where(eq(templates.id, id))
        .returning()
        .get();
    });
  },

  /**
   * Restore the shipped default content (versioned like any update). A seeded
   * default becomes Argus-managed again; a custom clone stays operator-owned.
   */
  resetToDefault(id: string): Template | undefined {
    const current = templatesDao.findById(id);
    if (!current) return undefined;
    return templatesDao.update(id, {
      ...MANAGED_DEFAULT_CONTENT,
      managed: current.isDefault,
      sourceHash: current.isDefault ? MANAGED_DEFAULT_HASH : current.sourceHash,
    });
  },

  delete(id: string): void {
    getDb().transaction((tx) => {
      tx.update(jobs).set({ templateId: null }).where(eq(jobs.templateId, id)).run();
      tx.delete(templates).where(eq(templates.id, id)).run();
    });
  },
};

/** Ensure every loaded report plugin (or only declarative plugins) has a managed default template row. */
export function ensureDefaultTemplates(declarativeOnly = false): number {
  let created = 0;
  for (const report of listReports()) {
    if (declarativeOnly && report.source !== "declarative") continue;
    if (templatesDao.defaultFor(report.id, "en")) continue;
    templatesDao.create({
      name: `${report.name} — Default`,
      reportType: report.id,
      ...MANAGED_DEFAULT_CONTENT,
      isDefault: true,
      language: "en",
      managed: true,
      sourceHash: MANAGED_DEFAULT_HASH,
    });
    created++;
  }
  return created;
}

/**
 * Upgrade Argus-managed templates to the current shipped default.
 *  - managed + content still hashes to `sourceHash` + default changed → upgrade
 *    (the prior content is snapshotted as a template version);
 *  - managed but content no longer matches `sourceHash` (edited outside the API,
 *    e.g. a restore) → flip to operator-owned, content untouched;
 *  - operator-owned → never touched; counted in `updatesAvailable` when it was
 *    forked from an older default.
 */
export function upgradeManagedTemplates(): { upgraded: number; detached: number; updatesAvailable: number } {
  let upgraded = 0;
  let detached = 0;
  let updatesAvailable = 0;
  for (const t of templatesDao.findAll()) {
    if (t.managed !== true) {
      if (t.isDefault && t.sourceHash && t.sourceHash !== MANAGED_DEFAULT_HASH) updatesAvailable++;
      continue;
    }
    const currentHash = templateContentHash({ subject: t.subject, htmlBody: t.htmlBody, textBody: t.textBody });
    if (currentHash === MANAGED_DEFAULT_HASH) {
      if (t.sourceHash !== MANAGED_DEFAULT_HASH) templatesDao.update(t.id, { sourceHash: MANAGED_DEFAULT_HASH });
      continue;
    }
    if (currentHash !== t.sourceHash) {
      templatesDao.update(t.id, { managed: false });
      detached++;
      continue;
    }
    templatesDao.update(t.id, { ...MANAGED_DEFAULT_CONTENT, sourceHash: MANAGED_DEFAULT_HASH });
    upgraded++;
  }
  return { upgraded, detached, updatesAvailable };
}

export const templateVersionsDao = {
  /** Prior snapshots for a template, newest version first. */
  list(templateId: string): TemplateVersion[] {
    return getDb()
      .select()
      .from(templateVersions)
      .where(eq(templateVersions.templateId, templateId))
      .orderBy(desc(templateVersions.version))
      .all();
  },

  findById(id: string): TemplateVersion | undefined {
    return getDb().select().from(templateVersions).where(eq(templateVersions.id, id)).get();
  },
};
