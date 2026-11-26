import { ensureDefaultTemplates, upgradeManagedTemplates } from "./dao/templates";
import { integrationsDao } from "./dao/integrations";
import { classifyTemplateOwnership } from "./template-ownership";
import { closeDb } from "./client";

/**
 * Idempotent seed: a default (editable) HTML template per report type, plus the
 * primary Microsoft 365 integration row. Safe to run on every container start.
 *
 * Template upgrades are ownership-aware: only Argus-managed templates whose
 * content is unchanged since they were seeded (hash match) are moved to the
 * latest default; operator-owned templates are never modified.
 */
export function seed(): {
  templates: number;
  upgraded: number;
  updatesAvailable: number;
  integrations: number;
} {
  classifyTemplateOwnership();
  const templates = ensureDefaultTemplates();
  const { upgraded, updatesAvailable } = upgradeManagedTemplates();

  let integrations = 0;
  if (!integrationsDao.findByProvider("microsoft365")) {
    integrationsDao.upsert("microsoft365", { name: "Microsoft 365", status: "disconnected" });
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
