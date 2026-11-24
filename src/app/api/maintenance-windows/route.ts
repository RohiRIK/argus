import { maintenanceWindowsDao } from "@/db/dao/maintenance-windows";
import { ok, fail } from "@/lib/api";
import { parseBody, maintenanceWindowInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** GET /api/maintenance-windows — list all configured maintenance windows. */
export async function GET() {
  try {
    const rows = maintenanceWindowsDao.list();
    return ok(rows, { total: rows.length });
  } catch (err) {
    return fail(err);
  }
}

/** POST /api/maintenance-windows — create a recurring or one-off maintenance window. */
export async function POST(req: Request) {
  try {
    const input = await parseBody(req, maintenanceWindowInputSchema);
    const created = maintenanceWindowsDao.create(input);
    return ok(created);
  } catch (err) {
    return fail(err);
  }
}
