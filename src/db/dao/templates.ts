import { eq, and, desc } from "drizzle-orm";
import { getDb, getRawDb } from "../client";
import { jobs, templates, templateVersions, type Template, type TemplateVersion } from "../schema";
import {
  DEFAULT_SUBJECT,
  DEFAULT_TEMPLATE_HTML,
  DEFAULT_TEXT_TEMPLATE,
  LEGACY_CATEGORY_SUBJECT,
  LEGACY_SUBJECT,
  LEGACY_TEMPLATE_HTML,
  LEGACY_TEXT_TEMPLATE,
  SHARED_TEMPLATE_TYPE,
} from "@/services/report-engine/default-template";

const nowIso = () => new Date().toISOString();

export const templatesDao = {
  findAll(): Template[] {
    return getDb().select().from(templates).all();
  },

  findById(id: string): Template | undefined {
    return getDb().select().from(templates).where(eq(templates.id, id)).get();
  },

  /** The one shared default template every report renders with unless a job overrides it. */
  sharedDefault(language: "en" | "he" = "en"): Template | undefined {
    return getDb()
      .select()
      .from(templates)
      .where(
        and(
          eq(templates.reportType, SHARED_TEMPLATE_TYPE),
          eq(templates.language, language),
          eq(templates.isDefault, true),
        ),
      )
      .get();
  },

  /** Resolve the template for a job: its explicit override, else the shared default. */
  resolve(templateId: string | null | undefined): Template | undefined {
    return (templateId ? templatesDao.findById(templateId) : undefined) ?? templatesDao.sharedDefault();
  },

  create(input: Omit<Template, "id" | "textBody"> & { id?: string; textBody?: string | null }): Template {
    return getDb()
      .insert(templates)
      .values({ ...input, id: input.id ?? crypto.randomUUID(), textBody: input.textBody ?? null })
      .returning()
      .get();
  },

  /**
   * Update a template, snapshotting its CURRENT content as a new version only when
   * subject/htmlBody/textBody actually changed. Runs in one transaction.
   */
  update(id: string, patch: Partial<Omit<Template, "id">>): Template | undefined {
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
      return tx.update(templates).set(patch).where(eq(templates.id, id)).returning().get();
    });
  },

  delete(id: string): void {
    getDb().transaction((tx) => {
      tx.update(jobs).set({ templateId: null }).where(eq(jobs.templateId, id)).run();
      tx.delete(templates).where(eq(templates.id, id)).run();
    });
  },
};

const SEEDED_SUBJECTS = new Set([DEFAULT_SUBJECT, LEGACY_SUBJECT, LEGACY_CATEGORY_SUBJECT]);
const SEEDED_HTML = new Set([DEFAULT_TEMPLATE_HTML, LEGACY_TEMPLATE_HTML]);
const SEEDED_TEXT = new Set<string | null>([DEFAULT_TEXT_TEMPLATE, LEGACY_TEXT_TEMPLATE, null]);

/**
 * Ensure the single shared default template exists, and retire the legacy
 * one-default-per-report rows: untouched seeded copies are deleted (referencing
 * jobs detach and fall back to the identical shared template); user-edited ones
 * are kept as regular custom templates (isDefault=false) so jobs can still pick them.
 * Idempotent. Returns how many shared templates were created (0 or 1).
 */
export function ensureSharedTemplate(): number {
  for (const t of templatesDao.findAll()) {
    if (!t.isDefault || t.reportType === SHARED_TEMPLATE_TYPE) continue;
    const untouched = SEEDED_SUBJECTS.has(t.subject) && SEEDED_HTML.has(t.htmlBody) && SEEDED_TEXT.has(t.textBody);
    if (untouched) templatesDao.delete(t.id);
    else getDb().update(templates).set({ isDefault: false }).where(eq(templates.id, t.id)).run();
  }
  if (templatesDao.sharedDefault("en")) return 0;
  templatesDao.create({
    name: "Shared report template",
    reportType: SHARED_TEMPLATE_TYPE,
    subject: DEFAULT_SUBJECT,
    htmlBody: DEFAULT_TEMPLATE_HTML,
    textBody: DEFAULT_TEXT_TEMPLATE,
    isDefault: true,
    language: "en",
  });
  return 1;
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
