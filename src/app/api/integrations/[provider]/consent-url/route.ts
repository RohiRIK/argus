import { adminConsentUrl } from "@/services/graph/permissions-grant";
import { AUTOMATION_PROVIDER } from "@/services/graph/automation-client";
import { getPublicOrigin } from "@/lib/request-origin";
import { vaultService } from "@/services/vault/vault";
import { ok, fail } from "@/lib/api";
import { ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string }> };

/** GET /api/integrations/:provider/consent-url — admin-consent URL for Entra app permissions. */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { provider } = await params;
    if (provider === AUTOMATION_PROVIDER) {
      const tenantId = vaultService.get("auto_tenantId") ?? vaultService.get("tenantId");
      const clientId = vaultService.get("auto_clientId");
      if (!tenantId || !clientId) {
        throw new ValidationError("Save Automation Tenant ID and Client ID first.");
      }
      const origin = getPublicOrigin(req);
      return ok({ url: adminConsentUrl(tenantId, clientId, `${origin}/settings/integrations`) });
    }
    if (provider !== "microsoft365") {
      throw new ValidationError("Consent is only supported for microsoft365 and microsoft365-automation");
    }
    const tenantId = vaultService.get("tenantId");
    const clientId = vaultService.get("clientId");
    if (!tenantId || !clientId) throw new ValidationError("Save Tenant ID and Client ID first.");
    const origin = getPublicOrigin(req);
    return ok({ url: adminConsentUrl(tenantId, clientId, `${origin}/settings/integrations`) });
  } catch (err) {
    return fail(err);
  }
}
