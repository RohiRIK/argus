import type { NextResponse } from "next/server";
import { getPublicOrigin } from "@/lib/request-origin";
import { SESSION_COOKIE, SESSION_TTL_MS, createSessionToken } from "./access";

/** Issue the signed session cookie for `username` on `res`. */
export async function setSessionCookie(res: NextResponse, req: Request, masterKey: string, username: string) {
  const { token, expiresAt } = await createSessionToken(masterKey, username);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: getPublicOrigin(req).startsWith("https://"),
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return expiresAt;
}
