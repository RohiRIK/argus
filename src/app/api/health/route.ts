import { getRawDb } from "@/db/client";
import { integrationsDao } from "@/db/dao/integrations";
import { getEnv, hasMasterKey } from "@/config/env";
import { vaultService } from "@/services/vault/vault";
import { ensureSchedulerStarted } from "@/services/scheduler";
import { activeRunCount } from "@/services/run-queue";
import { ok, fail } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth/access";
import pkg from "../../../../package.json";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — DB connection, WAL mode, vault status (AC-2).
 * Anonymous callers (Docker healthcheck, load balancers) get only the status;
 * signed-in operators get the full detail.
 */
export async function GET(req: Request) {
  try {
    // Boot the cron scheduler on first health probe (Docker hits this on start).
    ensureSchedulerStarted();
    const env = getEnv();
    const raw = getRawDb();
    const journalMode = (raw.query("PRAGMA journal_mode;").get() as { journal_mode: string })
      .journal_mode;
    const dbConnected = (raw.query("SELECT 1 AS ok;").get() as { ok: number }).ok === 1;
    const status = dbConnected ? "healthy" : "degraded";
    if (!(await isAuthenticated(req))) {
      return ok({ status, timestamp: new Date().toISOString() });
    }
    const m365 = integrationsDao.findByProvider("microsoft365");

    return ok({
      status,
      env: env.ARGUS_ENV,
      db: { connected: dbConnected, journalMode },
      vault: { masterKeyPresent: hasMasterKey(), configured: vaultService.isConfigured() },
      integrationStatus: m365?.status ?? "disconnected",
      queue: { active: activeRunCount() },
      auth: { mode: env.ARGUS_AUTH_MODE },
      version: pkg.version,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return fail(err);
  }
}
