import { ok, fail } from "@/lib/api";
import { ROLE_HEADER, USER_HEADER } from "@/lib/auth/access";
import { usersDao } from "@/db/dao/users";

export const dynamic = "force-dynamic";

/** GET /api/auth/me — the signed-in identity and role (set by the proxy), plus display details. */
export async function GET(req: Request) {
  try {
    const username = req.headers.get(USER_HEADER);
    const user = username ? usersDao.findByUsername(username) : undefined;
    return ok({
      username,
      role: req.headers.get(ROLE_HEADER) ?? "admin",
      displayName: user?.displayName ?? null,
      email: user?.email ?? null,
      authSource: user?.authSource ?? "local",
    });
  } catch (err) {
    return fail(err);
  }
}
