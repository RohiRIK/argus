import { testConnection } from "@/services/graph/connection-test";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/** POST /api/settings/permissions/remediate — re-validate after admin applied a fix. */
export async function POST() {
  try {
    const result = await testConnection();
    return ok({ revalidated: true, ...result });
  } catch (err) {
    return fail(err);
  }
}
