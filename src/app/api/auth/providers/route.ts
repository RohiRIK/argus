import { ok, fail } from "@/lib/api";
import { signInAvailability } from "@/services/auth/entra";

export const dynamic = "force-dynamic";

/** GET /api/auth/providers — which sign-in methods the login page should offer (public). */
export async function GET() {
  try {
    return ok({ password: true, microsoft: signInAvailability().available });
  } catch (err) {
    return fail(err);
  }
}
