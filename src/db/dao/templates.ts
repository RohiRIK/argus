import { eq, and, desc } from "drizzle-orm";
import { getDb, getRawDb } from "../client";
import { jobs, templates, templateVersions, type Template, type TemplateVersion } from "../schema";
import {
  MANAGED_DEFAULT_HASH,
  SHARED_DEFAULT_TYPES,
  isKnownDefaultContent,
  managedDefaultFor,
  templateContentHash,
} from "@/services/report-engine/managed-template";
import { SHARED_TEMPLATE_TYPE } from "@/services/report-engine/default-template";
import { AUTOMATION_TEMPLATE_TYPE } from "@/services/report-engine/automation-template";

const nowIso = () => new Date().toISOString();

export const templatesDao = {
  findAll(): Template[] {
    return getDb().select().from(templates).all();
  },

  findById(id: string): Template | undefined {
    return getDb().select().from(templates).where(eq(templates.id, id)).get();
  },

  /** The one shared default template every report renders with unless a job overrides it. */
  /**
   * The shared default every report (or, with AUTOMATION_TEMPLATE_TYPE, every
   * automation run) renders with unless a job overrides it.
   */
  sharedDefault(language: "en" | "he" = "en", type: string = SHARED_TEMPLATE_TYPE): Template | undefined {
    return getDb()
      .select()
      .from(templates)
      .where(and(eq(templates.reportType, type), eq(templates.language, language), eq(templates.isDefault, true)))
      .get();
  },


  /** Resolve the template for a job: its explicit override, else the shared default. */
  resolve(templateId: string | null | undefined): Template | undefined {
    return (templateId ? templatesDao.findById(templateId) : undefined) ?? templatesDao.sharedDefault();
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
    const shipped = managedDefaultFor(current.reportType);
    return templatesDao.update(id, {
      ...shipped.content,
      managed: current.isDefault,
      sourceHash: current.isDefault ? shipped.hash : current.sourceHash,
    });
  },

  delete(id: string): void {
    getDb().transaction((tx) => {
      tx.update(jobs).set({ templateId: null }).where(eq(jobs.templateId, id)).run();
      tx.delete(templates).where(eq(templates.id, id)).run();
    });
  },
};

/**
 * Ensure the single shared default template exists (Argus-managed: seed keeps it
 * on the latest default until an operator edits it), and retire the legacy
 * one-default-per-report rows: unedited seeded copies are deleted (referencing
 * jobs detach and fall back to the identical shared template); edited ones are
 * kept as operator-owned custom templates (isDefault=false) so jobs keep them.
 * Idempotent. Returns how many shared templates were created (0 or 1).
 */
export function ensureSharedTemplate(): number {
  for (const t of templatesDao.findAll()) {
    if (!t.isDefault || (SHARED_DEFAULT_TYPES as readonly string[]).includes(t.reportType)) continue;
    const untouched =
      t.managed === true ||
      isKnownDefaultContent({ subject: t.subject, htmlBody: t.htmlBody, textBody: t.textBody });
    if (untouched) templatesDao.delete(t.id);
    else getDb().update(templates).set({ isDefault: false, managed: false }).where(eq(templates.id, t.id)).run();
  }
  let created = 0;
  const names: Record<string, string> = {
    [SHARED_TEMPLATE_TYPE]: "Shared report template",
    [AUTOMATION_TEMPLATE_TYPE]: "Automation run template",
  };
  for (const type of SHARED_DEFAULT_TYPES) {
    if (templatesDao.sharedDefault("en", type)) continue;
    const shipped = managedDefaultFor(type);
    templatesDao.create({
      name: names[type],
      reportType: type,
      ...shipped.content,
      isDefault: true,
      language: "en",
      managed: true,
      sourceHash: shipped.hash,
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
    const shipped = managedDefaultFor(t.reportType);
    if (t.managed !== true) {
      if (t.isDefault && t.sourceHash && t.sourceHash !== shipped.hash) updatesAvailable++;
      continue;
    }
    const currentHash = templateContentHash({ subject: t.subject, htmlBody: t.htmlBody, textBody: t.textBody });
    if (currentHash === shipped.hash) {
      if (t.sourceHash !== shipped.hash) templatesDao.update(t.id, { sourceHash: shipped.hash });
      continue;
    }
    if (currentHash !== t.sourceHash) {
      templatesDao.update(t.id, { managed: false });
      detached++;
      continue;
    }
    templatesDao.update(t.id, { ...shipped.content, sourceHash: shipped.hash });
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
