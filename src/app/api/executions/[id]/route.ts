import { executionsDao, logsDao } from "@/db/dao/executions";
import { ok, fail } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** GET /api/executions/:id — execution details plus its logs. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const execution = executionsDao.findById(id);
    if (!execution) throw new NotFoundError(`Execution ${id} not found`);
    return ok({ execution, logs: logsDao.forExecution(id) });
  } catch (err) {
    return fail(err);
  }
}
