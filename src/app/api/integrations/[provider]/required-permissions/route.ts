import { requiredScopes } from "@/services/graph/connection-test";
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

export async function GET(req: Request, { params }: Ctx) {
  try {
    const { provider } = await params;
    if (provider === AUTOMATION_PROVIDER) {
      const activeOnly = new URL(req.url).searchParams.get("activeOnly") === "1";
      const scopes = await requiredAutomationScopes({ activeOnly });
      const clientId = vaultService.get("auto_clientId") ?? "";
      return ok({
        scopes,
        snippet: buildConsentSetupSnippet(clientId, scopes),
        clientId,
        clientIdPresent: Boolean(clientId),
      });
    }
    if (provider !== "microsoft365") {
      throw new ValidationError("Only supported for microsoft365 and microsoft365-automation");
    }
    const scopes = requiredScopes();
    const clientId = vaultService.get("clientId") ?? "";
    return ok({
      scopes,
      snippet: buildConsentSetupSnippet(clientId, scopes),
      clientId,
      clientIdPresent: Boolean(clientId),
    });
  } catch (err) {
    return fail(err);
  }
}
