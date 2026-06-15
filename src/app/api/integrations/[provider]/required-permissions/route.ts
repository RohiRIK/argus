import { requiredScopes } from "@/services/graph/connection-test";
import { buildConsentSetupSnippet } from "@/lib/graph-consent";
import { vaultService } from "@/services/vault/vault";
import { ok, fail } from "@/lib/api";
import { ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string }> };

/**
 * GET /api/integrations/:provider/required-permissions — the full set of Graph
 * application permissions Argus needs (union of every report's scopes + Mail.Send)
 * plus a copy-paste PowerShell snippet to grant them. Source of truth shared by
 * the Settings card and the job form.
 */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { provider } = await params;
    if (provider !== "microsoft365") throw new ValidationError("Only supported for microsoft365");
    const scopes = requiredScopes();
    const clientId = vaultService.get("clientId") ?? "";
    // clientId (the Entra application id) is a public identifier, not a secret — safe to return for the portal deep link.
    return ok({ scopes, snippet: buildConsentSetupSnippet(clientId, scopes), clientId, clientIdPresent: Boolean(clientId) });
  } catch (err) {
    return fail(err);
  }
}
