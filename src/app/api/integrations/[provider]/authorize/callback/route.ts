import { SIGNIN_CALLBACK_PATH } from "@/services/auth/entra";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForToken, appendAndGrant } from "@/services/graph/admin-authorize";
import { requiredScopes, testConnection } from "@/services/graph/connection-test";
import { vaultService } from "@/services/vault/vault";
import { auditDao } from "@/db/dao/audit";
import { AUTHORIZE_CALLBACK_PATH, OAUTH_STATE_COOKIE } from "@/lib/graph-consent";
import { getPublicOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string }> };

function popupBridgeHtml(origin: string, payload: Record<string, string | undefined>, fallbackUrl: string): NextResponse {
  const safePayload = JSON.stringify({ type: "argus-oauth-complete", ...payload });
  const safeUrl = JSON.stringify(fallbackUrl);
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Argus Authorization</title></head>
<body style="font-family:system-ui,sans-serif;padding:24px;background:#111;color:#eee">
<p>Authorization finished. Returning to Argus…</p>
<script>
(function(){
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(${safePayload}, ${JSON.stringify(origin)});
      window.close();
      return;
    }
  } catch (e) {}
  window.location.replace(${safeUrl});
})();
</script>
<noscript><a href="${fallbackUrl.replace(/"/g, "&quot;")}">Continue to Argus</a></noscript>
</body></html>`;
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

/**
 * GET /api/integrations/:provider/authorize/callback — the OAuth redirect target.
 * Validates CSRF state, exchanges the code for the admin's delegated token, then
 * declares + grants Argus's application permissions and persists verified status.
 */
export async function GET(req: Request, { params }: Ctx) {
  const origin = getPublicOrigin(req);
  const back = (payload: Record<string, string | undefined>) => {
    const qs = new URLSearchParams(
      Object.entries(payload).filter((e): e is [string, string] => typeof e[1] === "string"),
    ).toString();
    const res = popupBridgeHtml(origin, payload, `${origin}/settings/integrations?${qs}`);
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

    if (provider !== "microsoft365") return back({ authorized: "err", reason: "provider" });
    if (oauthError) return back({ authorized: "err", reason: url.searchParams.get("error_description") ?? oauthError });
    if (!code || !state || !cookieState || state !== cookieState) return back({ authorized: "err", reason: "state" });

    const tenantId = vaultService.get("tenantId") ?? "";
    const clientId = vaultService.get("clientId") ?? "";
    const clientSecret = vaultService.get("clientSecret");
    const privateKeyPem = vaultService.get("clientPrivateKey");
    const x5t = vaultService.get("certThumbprintX5t");
    const redirectUri = `${origin}${AUTHORIZE_CALLBACK_PATH}`;

    const token = await exchangeCodeForToken({ tenantId, clientId, clientSecret, privateKeyPem, x5t, code, redirectUri });
    // Also registers the Microsoft sign-in callback, so "Sign in with Microsoft" works after Authorize.
    const result = await appendAndGrant(token, clientId, requiredScopes(), {}, [`${origin}${SIGNIN_CALLBACK_PATH}`]);

    auditDao.record({
      action: "admin_authorize",
      provider: "microsoft365",
      outcome: result.stillMissing.length === 0 ? "success" : "partial",
      detail: { declared: result.declared, granted: result.granted, stillMissing: result.stillMissing },
    });

    // Persist connected status + discovered tenant details before returning to UI.
    await testConnection().catch(() => {});

    return back(
      result.stillMissing.length === 0
        ? { authorized: "ok" }
        : { authorized: "ok", partial: result.stillMissing.join(",") },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    auditDao.record({ action: "admin_authorize", provider: "microsoft365", outcome: "error", detail: { error: message } });
    return back({ authorized: "err", reason: message });
  }
}
