import { requiredScopes } from "@/services/graph/connection-test";
import { DIRECTORY_WRITE_SCOPES, directoryWritesEnabled, scopeGroups } from "@/services/graph/capabilities";
import { buildConsentSetupSnippet } from "@/lib/graph-consent";
import { vaultService } from "@/services/vault/vault";
import { ok, fail } from "@/lib/api";
import { ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string }> };

/**
 * GET /api/integrations/:provider/required-permissions — the Graph application
 * permissions Argus requests, grouped by capability (read reports, deliver mail,
 * and — only when opted in — write Entra groups), plus a copy-paste PowerShell
 * snippet to grant them. Source of truth shared by the Settings card and the job form.
 */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { provider } = await params;
    if (provider !== "microsoft365") throw new ValidationError("Only supported for microsoft365");
    const directoryWrites = directoryWritesEnabled();
    const scopes = requiredScopes({ directoryWrites });
    const clientId = vaultService.get("clientId") ?? "";
    // clientId (the Entra application id) is a public identifier, not a secret — safe to return for the portal deep link.
    return ok({
      scopes,
      groups: scopeGroups(directoryWrites),
      directoryWrites,
      optional: { directoryWrite: [...DIRECTORY_WRITE_SCOPES] },
      snippet: buildConsentSetupSnippet(clientId, scopes),
      clientId,
      clientIdPresent: Boolean(clientId),
    });
  } catch (err) {
    return fail(err);
  }
}
