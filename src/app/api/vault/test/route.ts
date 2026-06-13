import { testConnection } from "@/services/graph/connection-test";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/** POST /api/vault/test — validate stored credentials (PRD "Test Connection"). */
export async function POST() {
  try {
    return ok(await testConnection());
  } catch (err) {
    return fail(err);
  }
}
