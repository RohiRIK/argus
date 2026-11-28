import type { NextResponse } from "next/server";
import { getEnv } from "@/config/env";
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

/**
 * After revoking a user's sessions, give the caller's own browser a fresh session so
 * only their *other* sessions end. Call it after the revocation is stored: the new
 * token is issued at or after the revocation time. No-op when the gate is off.
 */
export async function renewSessionCookie(res: NextResponse, req: Request, username: string): Promise<void> {
  const env = getEnv();
  if (env.ARGUS_AUTH_MODE === "off" || !env.ARGUS_MASTER_KEY) return;
  await setSessionCookie(res, req, env.ARGUS_MASTER_KEY, username);
}
