import { z } from "zod";
import { NextResponse } from "next/server";
import { getEnv } from "@/config/env";
import { ok, fail } from "@/lib/api";
import { UnauthorizedError } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { setSessionCookie } from "@/lib/auth/session-cookie";
import { createFirstUser, setupStatus, MIN_PASSWORD_LENGTH } from "@/services/auth/accounts";
import { auditDao } from "@/db/dao/audit";

export const dynamic = "force-dynamic";

const schema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

/** GET /api/auth/setup — does Argus still need its first account, and is setup open? (public) */
export async function GET() {
  try {
    return ok({ ...setupStatus(), minPasswordLength: MIN_PASSWORD_LENGTH });
  } catch (err) {
    return fail(err);
  }
}

/** POST /api/auth/setup — create the first admin account and sign it in (public, first run only). */
export async function POST(req: Request) {
  try {
    const { username, password } = await parseBody(req, schema);
    const env = getEnv();
    if (!env.ARGUS_MASTER_KEY) throw new UnauthorizedError("Set ARGUS_MASTER_KEY before creating an account");
    const user = await createFirstUser(username, password);
    auditDao.record({ action: "auth.setup", outcome: "success", detail: { username: user.username } });
    const res = NextResponse.json({ success: true, data: { authenticated: true, username: user.username } });
    await setSessionCookie(res, req, env.ARGUS_MASTER_KEY, user.username);
    return res;
  } catch (err) {
    return fail(err);
  }
}
