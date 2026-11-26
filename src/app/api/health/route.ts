import { getRawDb } from "@/db/client";
import { integrationsDao } from "@/db/dao/integrations";
import { getEnv, hasMasterKey } from "@/config/env";
import { vaultService } from "@/services/vault/vault";
import { ensureSchedulerStarted } from "@/services/scheduler";
import { activeRunCount } from "@/services/run-queue";
import { ok, fail } from "@/lib/api";
import pkg from "../../../../package.json";

export const dynamic = "force-dynamic";

/** GET /api/health — DB connection, WAL mode, vault status (AC-2). */
export async function GET() {
  try {
    // Boot the cron scheduler on first health probe (Docker hits this on start).
    ensureSchedulerStarted();
    const env = getEnv();
    const raw = getRawDb();
    const journalMode = (raw.query("PRAGMA journal_mode;").get() as { journal_mode: string })
      .journal_mode;
    const dbConnected = (raw.query("SELECT 1 AS ok;").get() as { ok: number }).ok === 1;
    const m365 = integrationsDao.findByProvider("microsoft365");
    const m365Auto = integrationsDao.findByProvider("microsoft365-automation");

    return ok({
      status: dbConnected ? "healthy" : "degraded",
      env: env.ARGUS_ENV,
      db: { connected: dbConnected, journalMode },
      vault: {
        masterKeyPresent: hasMasterKey(),
        configured: vaultService.isConfigured(),
        automationConfigured: vaultService.isAutomationConfigured(),
      },
      integrationStatus: m365?.status ?? "disconnected",
      automationIntegrationStatus: m365Auto?.status ?? "disconnected",
      queue: { active: activeRunCount() },
      version: pkg.version,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return fail(err);
  }
}
