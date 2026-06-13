import { acquireToken } from "./auth";
import { vaultService } from "@/services/vault/vault";
import { settingsDao } from "@/db/dao/settings";

export interface ConnectionTestResult {
  ok: boolean;
  steps: {
    auth: { ok: boolean; latencyMs?: number; error?: string };
    mailbox: { ok: boolean; skipped?: boolean; note?: string; error?: string };
  };
}

/**
 * Validate the stored credentials (PRD "Test Connection"). Step 1 acquires a
 * Graph token. Step 2 (mailbox RBAC validation) requires a live tenant and is
 * reported as skipped in this build. Persists the resulting permissionStatus.
 */
export async function testConnection(): Promise<ConnectionTestResult> {
  const start = performance.now();
  try {
    await acquireToken({ forceRefresh: true });
  } catch (err) {
    settingsDao.update({
      permissionStatus: "error",
      lastPermissionCheck: new Date().toISOString(),
    });
    return {
      ok: false,
      steps: {
        auth: { ok: false, error: err instanceof Error ? err.message : String(err) },
        mailbox: { ok: false, skipped: true },
      },
    };
  }

  const latencyMs = Math.round(performance.now() - start);
  const mailbox = vaultService.get("mailbox");
  const mailboxOk = Boolean(mailbox);
  settingsDao.update({
    permissionStatus: mailboxOk ? "ok" : "missing",
    lastPermissionCheck: new Date().toISOString(),
  });

  return {
    ok: mailboxOk,
    steps: {
      auth: { ok: true, latencyMs },
      mailbox: {
        ok: mailboxOk,
        skipped: true,
        note: mailboxOk
          ? "mailbox set; live RBAC validation requires a tenant (deferred)"
          : "no mailbox configured in the vault",
      },
    },
  };
}
