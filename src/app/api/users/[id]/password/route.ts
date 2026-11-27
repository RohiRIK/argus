import { ok, fail } from "@/lib/api";
import { getPublicOrigin } from "@/lib/request-origin";
import { resetUserPassword } from "@/services/auth/users";
import { actorFrom } from "@/services/automations/safety";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/users/:id/password — email the user a new one-time password. Admin only. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    return ok(await resetUserPassword(id, actorFrom(req), getPublicOrigin(req)));
  } catch (err) {
    return fail(err);
  }
}
