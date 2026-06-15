import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../client";
import { templates, templateVersions, type Template, type TemplateVersion } from "../schema";

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

  create(input: Omit<Template, "id" | "textBody"> & { id?: string; textBody?: string | null }): Template {
    return getDb()
      .insert(templates)
      .values({ ...input, id: input.id ?? crypto.randomUUID(), textBody: input.textBody ?? null })
      .returning()
      .get();
  },

  /**
   * Update a template, first snapshotting its CURRENT content as a new version
   * (template version history, F5). Snapshot + update run in one transaction so
   * history and live state never diverge.
   */
  update(id: string, patch: Partial<Omit<Template, "id">>): Template | undefined {
    return getDb().transaction((tx) => {
      const current = tx.select().from(templates).where(eq(templates.id, id)).get();
      if (!current) return undefined;
      const existing = tx.select().from(templateVersions).where(eq(templateVersions.templateId, id)).all();
      tx.insert(templateVersions)
        .values({
          id: crypto.randomUUID(),
          templateId: id,
          version: existing.length + 1,
          subject: current.subject,
          htmlBody: current.htmlBody,
          textBody: current.textBody,
          createdAt: nowIso(),
        })
        .run();
      return tx.update(templates).set(patch).where(eq(templates.id, id)).returning().get();
    });
  },
};

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
