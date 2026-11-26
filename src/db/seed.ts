import { templatesDao, ensureSharedTemplate } from "./dao/templates";
import { integrationsDao } from "./dao/integrations";
import {
  DEFAULT_TEMPLATE_HTML,
  DEFAULT_SUBJECT,
  DEFAULT_TEXT_TEMPLATE,
  LEGACY_SUBJECT,
  LEGACY_CATEGORY_SUBJECT,
  LEGACY_TEMPLATE_HTML,
  LEGACY_TEXT_TEMPLATE,
} from "@/services/report-engine/default-template";
import { closeDb } from "./client";

/**
 * Idempotent seed: the one shared (editable) report template used by every
 * report, plus the primary Microsoft 365 integration row. Safe to run on every container start.
 */
export function seed(): { templates: number; integrations: number } {
  const templates = ensureSharedTemplate();

  // Upgrade untouched seeded templates to the latest hardened defaults in place.
  for (const t of templatesDao.findAll()) {
    const patch: Partial<Pick<typeof t, "subject" | "htmlBody" | "textBody">> = {};
    if (t.subject === LEGACY_SUBJECT || t.subject === LEGACY_CATEGORY_SUBJECT) patch.subject = DEFAULT_SUBJECT;
    if (t.htmlBody === LEGACY_TEMPLATE_HTML) patch.htmlBody = DEFAULT_TEMPLATE_HTML;
    if (t.textBody === LEGACY_TEXT_TEMPLATE) patch.textBody = DEFAULT_TEXT_TEMPLATE;
    if (Object.keys(patch).length > 0) templatesDao.update(t.id, patch);
  }

  let integrations = 0;
  if (!integrationsDao.findByProvider("microsoft365")) {
    integrationsDao.upsert("microsoft365", { name: "Microsoft 365", status: "disconnected" });
    integrations++;
  }
  if (!integrationsDao.findByProvider("microsoft365-automation")) {
    integrationsDao.upsert("microsoft365-automation", {
      name: "Microsoft 365 Automation",
      status: "disconnected",
    });
    integrations++;
  }

  return { templates, integrations };
}

if (import.meta.main) {
  try {
    const result = seed();
    // eslint-disable-next-line no-console
    console.log(`[argus] seed: ${result.templates} template(s), ${result.integrations} integration(s)`);
  } catch (err) {
    console.error("[argus] seed failed:", err);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}
