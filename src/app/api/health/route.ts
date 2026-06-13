import { getRawDb } from "@/db/client";
import { hasMasterKey } from "@/config/env";
import { vaultService } from "@/services/vault/vault";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/health — DB connection, WAL mode, vault status (AC-2). */
export async function GET() {
  try {
    const raw = getRawDb();
    const journalMode = (raw.query("PRAGMA journal_mode;").get() as { journal_mode: string })
      .journal_mode;
    const dbConnected = (raw.query("SELECT 1 AS ok;").get() as { ok: number }).ok === 1;

    return ok({
      status: dbConnected ? "healthy" : "degraded",
      db: { connected: dbConnected, journalMode },
      vault: { masterKeyPresent: hasMasterKey(), configured: vaultService.isConfigured() },
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return fail(err);
  }
}
