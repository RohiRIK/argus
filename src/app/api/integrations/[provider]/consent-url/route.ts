import { adminConsentUrl } from "@/services/graph/permissions-grant";
import { vaultService } from "@/services/vault/vault";
import { ok, fail } from "@/lib/api";
import { ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string }> };

/** GET /api/integrations/:provider/consent-url — admin-consent URL for the bootstrap step (D1). */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { provider } = await params;
    if (provider !== "microsoft365") throw new ValidationError("Consent is only supported for microsoft365");
    const tenantId = vaultService.get("tenantId");
    const clientId = vaultService.get("clientId");
    if (!tenantId || !clientId) throw new ValidationError("Save Tenant ID and Client ID first.");
    const origin = new URL(req.url).origin;
    return ok({ url: adminConsentUrl(tenantId, clientId, `${origin}/settings/integrations`) });
  } catch (err) {
    return fail(err);
  }
}
