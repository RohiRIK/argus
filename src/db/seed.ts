import { listReports } from "@/services/reports/registry";
import { templatesDao } from "./dao/templates";
import { integrationsDao } from "./dao/integrations";
import { DEFAULT_TEMPLATE_HTML, DEFAULT_SUBJECT } from "@/services/report-engine/default-template";
import { closeDb } from "./client";

/**
 * Idempotent seed: a default (editable) HTML template per report type, plus the
 * primary Microsoft 365 integration row. Safe to run on every container start.
 */
export function seed(): { templates: number; integrations: number } {
  let templates = 0;
  for (const report of listReports()) {
    if (templatesDao.defaultFor(report.id, "en")) continue;
    templatesDao.create({
      name: `${report.name} — Default`,
      reportType: report.id,
      subject: DEFAULT_SUBJECT,
      htmlBody: DEFAULT_TEMPLATE_HTML,
      isDefault: true,
      language: "en",
    });
    templates++;
  }

  let integrations = 0;
  if (!integrationsDao.findByProvider("microsoft365")) {
    integrationsDao.upsert("microsoft365", { name: "Microsoft 365", status: "disconnected" });
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
