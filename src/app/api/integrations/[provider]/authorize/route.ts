import { cookies } from "next/headers";
import { buildAdminAuthorizeUrl, AUTHORIZE_CALLBACK_PATH, OAUTH_STATE_COOKIE } from "@/lib/graph-consent";
import { vaultService } from "@/services/vault/vault";
import { ok, fail } from "@/lib/api";
import { ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string }> };

/**
 * GET /api/integrations/:provider/authorize — build the delegated admin authorization
 * URL (the "Authorize" button opens it in a popup) and stash a CSRF state cookie. Also
 * returns the exact redirect URI that must be registered on the app once.
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { provider } = await params;
    if (provider !== "microsoft365") throw new ValidationError("Authorize is only supported for microsoft365");
    const tenantId = vaultService.get("tenantId");
    const clientId = vaultService.get("clientId");
    if (!tenantId || !clientId) throw new ValidationError("Save Tenant ID and Client ID first.");

    const origin = new URL(req.url).origin;
    const redirectUri = `${origin}${AUTHORIZE_CALLBACK_PATH}`;
    const state = crypto.randomUUID();

    (await cookies()).set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600, // 10 min
    });

    return ok({ url: buildAdminAuthorizeUrl(tenantId, clientId, redirectUri, state), redirectUri });
  } catch (err) {
    return fail(err);
  }
}
