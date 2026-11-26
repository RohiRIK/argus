import { NextResponse, type NextRequest } from "next/server";
import { USER_HEADER, authenticate, isPublicPath } from "@/lib/auth/access";

/**
 * Operator access gate (plan H1). Every page and API route requires a signed-in
 * user (username + password session) or, for scripts, `Authorization: Bearer
 * <access key>` — except the sign-in flow and the minimal health probe. The
 * authenticated identity is passed on as `x-argus-user` for attribution.
 * Disable only with ARGUS_AUTH_MODE=off on a host nobody else can reach.
 */
export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  // Never trust a client-supplied identity header.
  const headers = new Headers(req.headers);
  headers.delete(USER_HEADER);
  if (isPublicPath(pathname)) return NextResponse.next({ request: { headers } });
  const user = await authenticate(req);
  if (user) {
    headers.set(USER_HEADER, user);
    return NextResponse.next({ request: { headers } });
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "UnauthorizedError", message: "Sign in to Argus" },
      },
      { status: 401 },
    );
  }

  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
