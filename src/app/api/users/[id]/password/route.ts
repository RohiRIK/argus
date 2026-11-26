import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { parseBody } from "@/lib/validation";
import { resetUserPassword } from "@/services/auth/users";
import { actorFrom } from "@/services/automations/safety";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ password: z.string().min(1).max(256) });

/** POST /api/users/:id/password — set a new temporary password for a local user. Admin only. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { password } = await parseBody(req, schema);
    await resetUserPassword(id, password, actorFrom(req));
    return ok({ reset: true });
  } catch (err) {
    return fail(err);
  }
}
