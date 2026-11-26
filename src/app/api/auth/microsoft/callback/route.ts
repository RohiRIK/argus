import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPublicOrigin } from "@/lib/request-origin";
import { getEnv } from "@/config/env";
import { setSessionCookie } from "@/lib/auth/session-cookie";
import { auditDao } from "@/db/dao/audit";
import { vaultService } from "@/services/vault/vault";
import {
  OIDC_COOKIE,
  SIGNIN_CALLBACK_PATH,
  decodeAttempt,
  exchangeCodeForIdToken,
  parseIdToken,
  roleFromGroups,
  signInAvailability,
  signInConfig,
  upsertEntraUser,
} from "@/services/auth/entra";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/microsoft/callback — Microsoft redirects here after sign-in (public).
 * Checks state, exchanges the code, validates the ID token, resolves the role from
 * Entra groups, creates/refreshes the account and starts an Argus session.
 */
export async function GET(req: Request) {
  const origin = getPublicOrigin(req);
  const toLogin = (message: string) => {
    const res = NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}`);
    res.cookies.set(OIDC_COOKIE, "", { path: "/api/auth/microsoft", maxAge: 0 });
    return res;
  };

  const url = new URL(req.url);
  const attempt = decodeAttempt((await cookies()).get(OIDC_COOKIE)?.value);
  try {
    const oauthError = url.searchParams.get("error");
    if (oauthError) return toLogin(url.searchParams.get("error_description")?.split("\r\n")[0] ?? oauthError);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!attempt || !code || !state || state !== attempt.state) {
      return toLogin("Your sign-in expired or was started elsewhere. Try again.");
    }
    if (!signInAvailability().available) return toLogin("Microsoft sign-in is not available.");
    const master = getEnv().ARGUS_MASTER_KEY;
    if (!master) return toLogin("Sign-in is unavailable until ARGUS_MASTER_KEY is set.");

    const idToken = await exchangeCodeForIdToken(code, attempt.verifier, `${origin}${SIGNIN_CALLBACK_PATH}`);
    const claims = parseIdToken(idToken, {
      tenantId: vaultService.get("tenantId") ?? "",
      clientId: vaultService.get("clientId") ?? "",
      nonce: attempt.nonce,
    });
    const role = await roleFromGroups(claims.oid, signInConfig());
    if (!role) {
      auditDao.record({ action: "auth.login", outcome: "error", detail: { username: claims.username, reason: "no group" } });
      return toLogin("Your Microsoft account isn't in any Argus group. Ask an Argus admin for access.");
    }
    const user = upsertEntraUser(claims, role);
    auditDao.record({ action: "auth.login", outcome: "success", detail: { username: user.username, method: "microsoft" } });

    const res = NextResponse.redirect(`${origin}${attempt.next}`);
    res.cookies.set(OIDC_COOKIE, "", { path: "/api/auth/microsoft", maxAge: 0 });
    await setSessionCookie(res, req, master, user.username);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Microsoft sign-in failed.";
    auditDao.record({ action: "auth.login", outcome: "error", detail: { method: "microsoft" } });
    return toLogin(message);
  }
}
