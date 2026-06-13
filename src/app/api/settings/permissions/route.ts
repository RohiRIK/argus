import { settingsDao } from "@/db/dao/settings";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/settings/permissions — current mailbox permission status. */
export async function GET() {
  try {
    const s = settingsDao.get();
    return ok({ status: s.permissionStatus, lastCheck: s.lastPermissionCheck });
  } catch (err) {
    return fail(err);
  }
}
