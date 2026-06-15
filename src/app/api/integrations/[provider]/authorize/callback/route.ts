import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForToken, appendAndGrant } from "@/services/graph/admin-authorize";
import { requiredScopes } from "@/services/graph/connection-test";
import { vaultService } from "@/services/vault/vault";
import { auditDao } from "@/db/dao/audit";
import { AUTHORIZE_CALLBACK_PATH, OAUTH_STATE_COOKIE } from "@/lib/graph-consent";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string }> };

/**
 * GET /api/integrations/:provider/authorize/callback — the OAuth redirect target.
 * Validates CSRF state, exchanges the code for the admin's delegated token, then
 * declares + grants Argus's application permissions. Always redirects back to
 * Settings with an `authorized=ok|err` result; never leaks the token.
 */
export async function GET(req: Request, { params }: Ctx) {
  const origin = new URL(req.url).origin;
  const back = (q: string) => NextResponse.redirect(new URL(`/settings/integrations?${q}`, origin));
  const clearState = (res: NextResponse) => {
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  try {
    const { provider } = await params;
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");
    const cookieState = (await cookies()).get(OAUTH_STATE_COOKIE)?.value;

    if (provider !== "microsoft365") return clearState(back("authorized=err&reason=provider"));
    if (oauthError) return clearState(back(`authorized=err&reason=${encodeURIComponent(url.searchParams.get("error_description") ?? oauthError)}`));
    if (!code || !state || !cookieState || state !== cookieState) return clearState(back("authorized=err&reason=state"));

    const tenantId = vaultService.get("tenantId") ?? "";
    const clientId = vaultService.get("clientId") ?? "";
    const clientSecret = vaultService.get("clientSecret") ?? "";
    const redirectUri = `${origin}${AUTHORIZE_CALLBACK_PATH}`;

    const token = await exchangeCodeForToken({ tenantId, clientId, clientSecret, code, redirectUri });
    const result = await appendAndGrant(token, clientId, requiredScopes());

    auditDao.record({
      action: "admin_authorize",
      provider: "microsoft365",
      outcome: result.stillMissing.length === 0 ? "success" : "partial",
      detail: { declared: result.declared, granted: result.granted, stillMissing: result.stillMissing },
    });

    const q = result.stillMissing.length === 0 ? "authorized=ok" : `authorized=ok&partial=${encodeURIComponent(result.stillMissing.join(","))}`;
    return clearState(back(q));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    auditDao.record({ action: "admin_authorize", provider: "microsoft365", outcome: "error", detail: { error: message } });
    return clearState(back(`authorized=err&reason=${encodeURIComponent(message)}`));
  }
}
