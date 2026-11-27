import { requiredScopes } from "@/services/graph/connection-test";
import { DIRECTORY_WRITE_SCOPES, directoryWritesEnabled, scopeGroups } from "@/services/graph/capabilities";
import {
  AUTOMATION_PROVIDER,
  requiredAutomationScopes,
} from "@/services/graph/automation-client";
import { buildConsentSetupSnippet } from "@/lib/graph-consent";
import { vaultService } from "@/services/vault/vault";
import { ok, fail } from "@/lib/api";
import { ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string }> };

/**
 * GET /api/integrations/:provider/required-permissions — the Graph application
 * permissions Argus requests, plus a copy-paste PowerShell snippet to grant them.
 *  - microsoft365 (reporting): grouped by capability (read reports, deliver mail,
 *    and — only when opted in — write Entra groups).
 *  - microsoft365-automation (separate write app): scopes of the ACTIVE automation
 *    policies only by default (least privilege); `?all=1` lists every automation's scopes.
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { provider } = await params;
    if (provider === AUTOMATION_PROVIDER) {
      const all = new URL(req.url).searchParams.get("all") === "1";
      const scopes = await requiredAutomationScopes({ activeOnly: !all });
      const clientId = vaultService.get("auto_clientId") ?? "";
      return ok({
        scopes,
        activeOnly: !all,
        snippet: buildConsentSetupSnippet(clientId, scopes),
        clientId,
        clientIdPresent: Boolean(clientId),
      });
    }
    if (provider !== "microsoft365") {
      throw new ValidationError("Only supported for microsoft365 and microsoft365-automation");
    }
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
