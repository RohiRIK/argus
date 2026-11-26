import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

/** POST /api/auth/logout — clear the session cookie. */
export async function POST() {
  const res = NextResponse.json({ success: true, data: { authenticated: false } });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
