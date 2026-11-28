import { NextResponse, type NextRequest } from "next/server";
import { ROLE_HEADER, SESSION_COOKIE, USER_HEADER, authenticateRequest, isPublicPath } from "@/lib/auth/access";
import { ROLE_LABEL, hasRole, requiredRole } from "@/lib/auth/roles";
import { resolveIdentity } from "@/services/auth/identity";

/**
 * Operator access gate (plan H1) + role check. Every page and API route requires a
 * signed-in user (password or Microsoft session) or, for scripts, `Authorization:
 * Bearer <access key>` — except the sign-in flow and the minimal health probe.
 * The user's role is read from the database on every request (proxy runs on Node),
 * so role changes, disabled accounts and revoked sessions apply at once. The identity and role are
 * passed on as `x-argus-user` / `x-argus-role`.
 * Disable only with ARGUS_AUTH_MODE=off on a host nobody else can reach.
 */
/** Where a user with a one-time password must go, and the only paths they can use. */
const CHANGE_PASSWORD_PAGE = "/change-password";
const PASSWORD_CHANGE_PATHS = new Set([CHANGE_PASSWORD_PAGE, "/api/auth/password", "/api/auth/logout", "/api/auth/me"]);

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  // Never trust a client-supplied identity or role header.
  const headers = new Headers(req.headers);
  headers.delete(USER_HEADER);
  headers.delete(ROLE_HEADER);
  if (isPublicPath(pathname)) return NextResponse.next({ request: { headers } });

  const auth = await authenticateRequest(req);
  const name = auth?.name ?? null;
  const identity = auth ? resolveIdentity(auth.name, auth.issuedAt) : null;
  if (identity) {
    // One-time password: only the "set your password" page and its API until they choose one.
    if (identity.mustChangePassword && !PASSWORD_CHANGE_PATHS.has(pathname)) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          {
            success: false,
            error: { code: "PasswordChangeRequired", message: "Choose your own password first." },
          },
          { status: 403 },
        );
      }
      const to = req.nextUrl.clone();
      to.pathname = CHANGE_PASSWORD_PAGE;
      to.search = `?next=${encodeURIComponent(pathname + search)}`;
      return NextResponse.redirect(to);
    }
    const needed = requiredRole(req.method, pathname);
    if (!hasRole(identity.role, needed)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "ForbiddenError",
            message: `Your role (${ROLE_LABEL[identity.role]}) can't do this — it needs ${ROLE_LABEL[needed]}.`,
          },
        },
        { status: 403 },
      );
    }
    headers.set(USER_HEADER, identity.username);
    headers.set(ROLE_HEADER, identity.role);
    return NextResponse.next({ request: { headers } });
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { success: false, error: { code: "UnauthorizedError", message: "Sign in to Argus" } },
      { status: 401 },
    );
  }

  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.search = `?next=${encodeURIComponent(pathname + search)}`;
  const res = NextResponse.redirect(login);
  // A valid cookie for a removed/disabled account or a revoked session: drop it so the login page is clean.
  if (name) res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
