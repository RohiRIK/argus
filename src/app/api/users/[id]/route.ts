import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { parseBody } from "@/lib/validation";
import { deleteUser, updateUser } from "@/services/auth/users";
import { actorFrom } from "@/services/automations/safety";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    role: z.enum(["admin", "operator", "viewer"]).optional(),
    disabled: z.boolean().optional(),
  })
  .refine((p) => p.role !== undefined || p.disabled !== undefined, { message: "Nothing to change" });

/** PATCH /api/users/:id — change role and/or disable/enable. Admin only. */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const patch = await parseBody(req, patchSchema);
    return ok(updateUser(id, patch, actorFrom(req)));
  } catch (err) {
    return fail(err);
  }
}

/** DELETE /api/users/:id — remove an account. Admin only; never yourself or the last admin. */
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    deleteUser(id, actorFrom(req));
    return ok({ deleted: true });
  } catch (err) {
    return fail(err);
  }
}
