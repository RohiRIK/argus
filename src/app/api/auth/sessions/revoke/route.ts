import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { UnauthorizedError } from "@/lib/errors";
import { API_KEY_USER, USER_HEADER } from "@/lib/auth/access";
import { renewSessionCookie } from "@/lib/auth/session-cookie";
import { usersDao } from "@/db/dao/users";
import { auditDao } from "@/db/dao/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/sessions/revoke — sign the current user out of every other browser
 * and device. This browser gets a fresh session and stays signed in.
 */
export async function POST(req: Request) {
  try {
    const username = req.headers.get(USER_HEADER);
    const user = username && username !== API_KEY_USER && username !== "anonymous" ? usersDao.findByUsername(username) : undefined;
    if (!user) throw new UnauthorizedError("Sign in with a user account to sign out its other sessions");
    usersDao.revokeSessions(user.id);
    auditDao.record({ action: "auth.sessions_revoked", outcome: "success", detail: { username: user.username } });
    const res = NextResponse.json({ success: true, data: { otherSessionsSignedOut: true } });
    await renewSessionCookie(res, req, user.username);
    return res;
  } catch (err) {
    return fail(err);
  }
}
