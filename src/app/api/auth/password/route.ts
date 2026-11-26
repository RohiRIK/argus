import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { UnauthorizedError } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { API_KEY_USER, USER_HEADER } from "@/lib/auth/access";
import { changePassword } from "@/services/auth/accounts";
import { auditDao } from "@/db/dao/audit";

export const dynamic = "force-dynamic";

const schema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(1).max(256),
});

/** POST /api/auth/password — change the signed-in user's password. */
export async function POST(req: Request) {
  try {
    const username = req.headers.get(USER_HEADER);
    if (!username || username === API_KEY_USER || username === "anonymous") {
      throw new UnauthorizedError("Sign in with a user account to change its password");
    }
    const { currentPassword, newPassword } = await parseBody(req, schema);
    await changePassword(username, currentPassword, newPassword);
    auditDao.record({ action: "auth.password_changed", outcome: "success", detail: { username } });
    return ok({ changed: true });
  } catch (err) {
    return fail(err);
  }
}
