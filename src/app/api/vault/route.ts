import { vaultService } from "@/services/vault/vault";
import { integrationsDao } from "@/db/dao/integrations";
import { clearTokenCache } from "@/services/graph/auth";
import { resetGraphClient } from "@/services/graph/client";
import {
  AUTOMATION_PROVIDER,
  clearAutomationTokenCache,
  resetAutomationGraphClient,
} from "@/services/graph/automation-client";
import { hasMasterKey } from "@/config/env";
import { ok, fail } from "@/lib/api";
import { parseBody, vaultInputSchema } from "@/lib/validation";
import { VaultError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const GRAPH_CREDENTIAL_KEYS = new Set(["tenantId", "clientId", "clientSecret", "clientPrivateKey", "certThumbprintX5t"]);
const AUTO_CREDENTIAL_KEYS = new Set([
  "auto_tenantId",
  "auto_clientId",
  "auto_clientSecret",
  "auto_clientPrivateKey",
  "auto_certThumbprintX5t",
]);

/** GET /api/vault — list stored keys with masked values (never plaintext). */
export async function GET() {
  try {
    return ok({
      masterKeyPresent: hasMasterKey(),
      configured: vaultService.isConfigured(),
      authMode: vaultService.authMode(),
      automationConfigured: vaultService.isAutomationConfigured(),
      automationAuthMode: vaultService.automationAuthMode(),
      entries: vaultService.list(),
    });
  } catch (err) {
    return fail(err);
  }
}

/** PUT /api/vault — upsert one or more credentials (encrypted server-side). */
export async function PUT(req: Request) {
  try {
    if (!hasMasterKey()) throw new VaultError("Cannot store credentials: ARGUS_MASTER_KEY is not set");
    const rawUpdates = await parseBody(req, vaultInputSchema);
    const updates: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawUpdates)) {
      const keepRaw =
        key === "clientSecret" ||
        key === "clientPrivateKey" ||
        key === "auto_clientSecret" ||
        key === "auto_clientPrivateKey";
      updates[key] = keepRaw ? value : value.trim();
    }
    const identityChanged =
      (updates.tenantId && updates.tenantId !== vaultService.get("tenantId")) ||
      (updates.clientId && updates.clientId !== vaultService.get("clientId"));
    const autoIdentityChanged =
      (updates.auto_tenantId && updates.auto_tenantId !== vaultService.get("auto_tenantId")) ||
      (updates.auto_clientId && updates.auto_clientId !== vaultService.get("auto_clientId"));

    for (const [key, value] of Object.entries(updates)) vaultService.set(key, value);

    if (Object.keys(updates).some((k) => GRAPH_CREDENTIAL_KEYS.has(k))) {
      clearTokenCache();
      resetGraphClient();
    }
    if (Object.keys(updates).some((k) => AUTO_CREDENTIAL_KEYS.has(k) || k === "tenantId")) {
      clearAutomationTokenCache();
      resetAutomationGraphClient();
    }
    if (identityChanged) {
      integrationsDao.upsert("microsoft365", { status: "disconnected", errorMessage: null });
    }
    if (autoIdentityChanged) {
      integrationsDao.upsert(AUTOMATION_PROVIDER, {
        name: "Microsoft 365 Automation",
        status: "disconnected",
        errorMessage: null,
      });
    }
    return ok({
      updated: Object.keys(updates),
      authMode: vaultService.authMode(),
      automationAuthMode: vaultService.automationAuthMode(),
    });
  } catch (err) {
    return fail(err);
  }
}
