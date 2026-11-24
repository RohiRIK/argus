import { maintenanceWindowsDao } from "@/db/dao/maintenance-windows";
import { ok, fail } from "@/lib/api";
import { parseBody, maintenanceWindowPatchSchema } from "@/lib/validation";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/maintenance-windows/:id — fetch a single maintenance window. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const row = maintenanceWindowsDao.findById(id);
    if (!row) throw new NotFoundError(`Maintenance window ${id} not found`);
    return ok(row);
  } catch (err) {
    return fail(err);
  }
}

/** PUT /api/maintenance-windows/:id — update or toggle a maintenance window. */
export async function PUT(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const patch = await parseBody(req, maintenanceWindowPatchSchema);
    const updated = maintenanceWindowsDao.update(id, patch);
    if (!updated) throw new NotFoundError(`Maintenance window ${id} not found`);
    return ok(updated);
  } catch (err) {
    return fail(err);
  }
}

/** DELETE /api/maintenance-windows/:id — remove a maintenance window. */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!maintenanceWindowsDao.findById(id)) {
      throw new NotFoundError(`Maintenance window ${id} not found`);
    }
    maintenanceWindowsDao.delete(id);
    return ok({ deleted: id });
  } catch (err) {
    return fail(err);
  }
}
