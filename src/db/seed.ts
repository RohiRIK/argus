import { ensureSharedTemplate, upgradeManagedTemplates } from "./dao/templates";
import { integrationsDao } from "./dao/integrations";
import { classifyTemplateOwnership } from "./template-ownership";
import { closeDb } from "./client";

/**
 * Idempotent seed: the one shared (editable) report template used by every
 * report, plus the Microsoft 365 reporting and automation integration rows.
 * Safe to run on every container start.
 *
 * Template upgrades are ownership-aware: the shared default is Argus-managed and
 * moves to the latest default only while its content is unchanged since it was
 * seeded (hash match); operator-edited templates are never modified.
 */
export function seed(): {
  templates: number;
  upgraded: number;
  updatesAvailable: number;
  integrations: number;
} {
  classifyTemplateOwnership();
  const templates = ensureSharedTemplate();
  const { upgraded, updatesAvailable } = upgradeManagedTemplates();

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

  return { templates, upgraded, updatesAvailable, integrations };
}

if (import.meta.main) {
  try {
    const result = seed();
    // eslint-disable-next-line no-console
    console.log(
      `[argus] seed: ${result.templates} template(s) created, ${result.upgraded} managed template(s) upgraded, ` +
        `${result.updatesAvailable} operator-owned template(s) with a newer default available, ` +
        `${result.integrations} integration(s)`,
    );
  } catch (err) {
    console.error("[argus] seed failed:", err);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}
