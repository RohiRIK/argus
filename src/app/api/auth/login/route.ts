import { z } from "zod";
import { NextResponse } from "next/server";
import { getEnv } from "@/config/env";
import { fail } from "@/lib/api";
import { UnauthorizedError } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { logger } from "@/lib/logger";
import { setSessionCookie } from "@/lib/auth/session-cookie";
import { verifyLogin } from "@/services/auth/accounts";
import { auditDao } from "@/db/dao/audit";
import type { User } from "@/db/schema";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

/** POST /api/auth/login — username + password → 12-hour session cookie. */
export async function POST(req: Request) {
  try {
    const { username, password } = await parseBody(req, loginSchema);
    const env = getEnv();
    if (env.ARGUS_AUTH_MODE === "off") {
      return NextResponse.json({ success: true, data: { authenticated: true, mode: "off" } });
    }
    if (!env.ARGUS_MASTER_KEY) {
      throw new UnauthorizedError("Sign-in is unavailable until ARGUS_MASTER_KEY is set");
    }

    let user: User;
    try {
      user = await verifyLogin(username, password);
    } catch (err) {
      logger.warn("auth: rejected sign-in attempt");
      auditDao.record({ action: "auth.login", outcome: "error", detail: { username: username.trim().toLowerCase() } });
      throw err;
    }

    auditDao.record({ action: "auth.login", outcome: "success", detail: { username: user.username } });
    const res = NextResponse.json({ success: true, data: { authenticated: true, username: user.username } });
    await setSessionCookie(res, req, env.ARGUS_MASTER_KEY, user.username);
    return res;
  } catch (err) {
    return fail(err);
  }
}
