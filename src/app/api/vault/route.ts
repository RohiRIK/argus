import { vaultService } from "@/services/vault/vault";
import { integrationsDao } from "@/db/dao/integrations";
import { clearTokenCache } from "@/services/graph/auth";
import { resetGraphClient } from "@/services/graph/client";
import { hasMasterKey } from "@/config/env";
import { ok, fail } from "@/lib/api";
import { parseBody, vaultInputSchema } from "@/lib/validation";
import { VaultError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const GRAPH_CREDENTIAL_KEYS = new Set(["tenantId", "clientId", "clientSecret", "clientPrivateKey", "certThumbprintX5t"]);

/** GET /api/vault — list stored keys with masked values (never plaintext). */
export async function GET() {
  try {
    return ok({
      masterKeyPresent: hasMasterKey(),
      configured: vaultService.isConfigured(),
      authMode: vaultService.authMode(),
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
      updates[key] = key === "clientSecret" || key === "clientPrivateKey" ? value : value.trim();
    }
    const identityChanged =
      (updates.tenantId && updates.tenantId !== vaultService.get("tenantId")) ||
      (updates.clientId && updates.clientId !== vaultService.get("clientId"));

    for (const [key, value] of Object.entries(updates)) vaultService.set(key, value);

    if (Object.keys(updates).some((k) => GRAPH_CREDENTIAL_KEYS.has(k))) {
      clearTokenCache();
      resetGraphClient();
    }
    if (identityChanged) {
      integrationsDao.upsert("microsoft365", { status: "disconnected", errorMessage: null });
    }
    return ok({ updated: Object.keys(updates), authMode: vaultService.authMode() });
  } catch (err) {
    return fail(err);
  }
}
