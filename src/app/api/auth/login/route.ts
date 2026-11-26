import { z } from "zod";
import { NextResponse } from "next/server";
import { getEnv } from "@/config/env";
import { fail } from "@/lib/api";
import { UnauthorizedError } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { getPublicOrigin } from "@/lib/request-origin";
import { logger } from "@/lib/logger";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSessionToken,
  verifyAccessKey,
} from "@/lib/auth/access";

export const dynamic = "force-dynamic";

const loginSchema = z.object({ accessKey: z.string().min(1).max(256) });

/** POST /api/auth/login — exchange the operator access key for a session cookie. */
export async function POST(req: Request) {
  try {
    const { accessKey } = await parseBody(req, loginSchema);
    const env = getEnv();
    if (env.ARGUS_AUTH_MODE === "off") {
      return NextResponse.json({ success: true, data: { authenticated: true, mode: "off" } });
    }
    if (!env.ARGUS_MASTER_KEY) {
      throw new UnauthorizedError("Sign-in is unavailable until ARGUS_MASTER_KEY is set");
    }
    if (!(await verifyAccessKey(env.ARGUS_MASTER_KEY, accessKey))) {
      logger.warn("auth: rejected sign-in attempt");
      throw new UnauthorizedError("Access key is not valid");
    }

    const { token, expiresAt } = await createSessionToken(env.ARGUS_MASTER_KEY);
    const res = NextResponse.json({
      success: true,
      data: { authenticated: true, expiresAt: new Date(expiresAt).toISOString() },
    });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: getPublicOrigin(req).startsWith("https://"),
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    return res;
  } catch (err) {
    return fail(err);
  }
}
