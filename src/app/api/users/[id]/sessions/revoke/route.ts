import { ok, fail } from "@/lib/api";
import { signOutEverywhere } from "@/services/auth/users";
import { actorFrom } from "@/services/automations/safety";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/users/:id/sessions/revoke — sign this user out of every browser and device. Admin only. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    return ok(signOutEverywhere(id, actorFrom(req)));
  } catch (err) {
    return fail(err);
  }
}
