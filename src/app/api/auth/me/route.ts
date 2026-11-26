import { ok, fail } from "@/lib/api";
import { USER_HEADER } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

/** GET /api/auth/me — the signed-in identity (set by the proxy). */
export async function GET(req: Request) {
  try {
    return ok({ username: req.headers.get(USER_HEADER) });
  } catch (err) {
    return fail(err);
  }
}
