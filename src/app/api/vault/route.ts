import { vaultService } from "@/services/vault/vault";
import { hasMasterKey } from "@/config/env";
import { ok, fail } from "@/lib/api";
import { parseBody, vaultInputSchema } from "@/lib/validation";
import { VaultError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** GET /api/vault — list stored keys with masked values (never plaintext). */
export async function GET() {
  try {
    return ok({ masterKeyPresent: hasMasterKey(), configured: vaultService.isConfigured(), entries: vaultService.list() });
  } catch (err) {
    return fail(err);
  }
}

/** PUT /api/vault — upsert one or more credentials (encrypted server-side). */
export async function PUT(req: Request) {
  try {
    if (!hasMasterKey()) throw new VaultError("Cannot store credentials: ARGUS_MASTER_KEY is not set");
    const updates = await parseBody(req, vaultInputSchema);
    for (const [key, value] of Object.entries(updates)) vaultService.set(key, value);
    return ok({ updated: Object.keys(updates) });
  } catch (err) {
    return fail(err);
  }
}
