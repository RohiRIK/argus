import { z } from "zod";
import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { UnauthorizedError } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { API_KEY_USER, USER_HEADER } from "@/lib/auth/access";
import { renewSessionCookie } from "@/lib/auth/session-cookie";
import { changePassword } from "@/services/auth/accounts";
import { auditDao } from "@/db/dao/audit";

export const dynamic = "force-dynamic";

const schema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(1).max(256),
});

/**
 * POST /api/auth/password — change the signed-in user's password. Every other session
 * of this user is signed out; this browser gets a fresh session and stays signed in.
 */
export async function POST(req: Request) {
  try {
    const username = req.headers.get(USER_HEADER);
    if (!username || username === API_KEY_USER || username === "anonymous") {
      throw new UnauthorizedError("Sign in with a user account to change its password");
    }
    const { currentPassword, newPassword } = await parseBody(req, schema);
    await changePassword(username, currentPassword, newPassword);
    auditDao.record({ action: "auth.password_changed", outcome: "success", detail: { username } });
    const res = NextResponse.json({ success: true, data: { changed: true, otherSessionsSignedOut: true } });
    await renewSessionCookie(res, req, username);
    return res;
  } catch (err) {
    return fail(err);
  }
}
