import { NextResponse, type NextRequest } from "next/server";
import { isAuthenticated, isPublicPath } from "@/lib/auth/access";

/**
 * Operator access gate (plan H1). Every page and API route requires a valid
 * session cookie or `Authorization: Bearer <access key>`, except the login
 * flow and the minimal health probe. Disable only with ARGUS_AUTH_MODE=off on
 * a host that is not reachable by anyone else.
 */
export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  if (await isAuthenticated(req)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "UnauthorizedError", message: "Sign in with the Argus access key" },
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
