import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { parseBody } from "@/lib/validation";
import { createLocalUser, listUsers } from "@/services/auth/users";
import { actorFrom } from "@/services/automations/safety";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
  role: z.enum(["admin", "operator", "viewer"]),
});

/** GET /api/users — every account (no password hashes). Admin only (proxy). */
export async function GET() {
  try {
    return ok(listUsers());
  } catch (err) {
    return fail(err);
  }
}

/** POST /api/users — add a local user with a temporary password and a role. Admin only. */
export async function POST(req: Request) {
  try {
    const input = await parseBody(req, createSchema);
    return ok(await createLocalUser(input, actorFrom(req)));
  } catch (err) {
    return fail(err);
  }
}
