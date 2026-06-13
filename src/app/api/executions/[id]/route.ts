import { executionsDao, logsDao } from "@/db/dao/executions";
import { ok, fail } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** GET /api/executions/:id — execution details plus its logs. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const execution = executionsDao.findById(params.id);
    if (!execution) throw new NotFoundError(`Execution ${params.id} not found`);
    return ok({ execution, logs: logsDao.forExecution(params.id) });
  } catch (err) {
    return fail(err);
  }
}
