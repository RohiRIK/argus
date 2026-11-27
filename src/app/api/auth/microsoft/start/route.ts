import { NextResponse } from "next/server";
import { getPublicOrigin } from "@/lib/request-origin";
import { safeNextPath } from "@/lib/auth/access";
import {
  OIDC_COOKIE,
  OIDC_COOKIE_MAX_AGE,
  SIGNIN_CALLBACK_PATH,
  authorizeUrl,
  encodeAttempt,
  newAttempt,
  signInAvailability,
} from "@/services/auth/entra";

export const dynamic = "force-dynamic";

/** GET /api/auth/microsoft/start?next= — begin "Sign in with Microsoft" (public). */
export async function GET(req: Request) {
  const origin = getPublicOrigin(req);
  const avail = signInAvailability();
  if (!avail.available) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(avail.reason ?? "Microsoft sign-in is not available.")}`);
  }
  const attempt = newAttempt(safeNextPath(new URL(req.url).searchParams.get("next")));
  const res = NextResponse.redirect(authorizeUrl(attempt, `${origin}${SIGNIN_CALLBACK_PATH}`));
  res.cookies.set(OIDC_COOKIE, encodeAttempt(attempt), {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/api/auth/microsoft",
    maxAge: OIDC_COOKIE_MAX_AGE,
  });
  return res;
}
