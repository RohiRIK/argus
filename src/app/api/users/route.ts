import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { parseBody } from "@/lib/validation";
import { getPublicOrigin } from "@/lib/request-origin";
import { createLocalUser, inviteEntraUser, listUsers } from "@/services/auth/users";
import { actorFrom } from "@/services/automations/safety";

export const dynamic = "force-dynamic";

const role = z.enum(["admin", "operator", "viewer"]);

const createSchema = z.discriminatedUnion("source", [
  // From Entra ID: invited by email, signs in with Microsoft.
  z.object({ source: z.literal("entra"), entraId: z.string().uuid(), role, sendEmail: z.boolean().default(true) }),
  // Password account: a one-time password is emailed to this address.
  z.object({ source: z.literal("local"), email: z.string().min(3).max(254), role }),
]);

/** GET /api/users — every account (no password hashes). Admin only (proxy). */
export async function GET() {
  try {
    return ok(listUsers());
  } catch (err) {
    return fail(err);
  }
}

/** POST /api/users — invite someone from Entra ID, or add a password account. Admin only. */
export async function POST(req: Request) {
  try {
    const input = await parseBody(req, createSchema);
    const actor = actorFrom(req);
    if (input.source === "entra") {
      return ok(await inviteEntraUser({ ...input, sendEmail: input.sendEmail ?? true }, actor, getPublicOrigin(req)));
    }
    return ok(await createLocalUser(input, actor, getPublicOrigin(req)));
  } catch (err) {
    return fail(err);
  }
}
