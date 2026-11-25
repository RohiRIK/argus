import { executionsDao } from "@/db/dao/executions";
import { fail } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** GET /api/executions/:id/preview — the generated HTML report (raw). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const execution = executionsDao.findById(id);
    if (!execution) throw new NotFoundError(`Execution ${id} not found`);
    return new Response(execution.outputHtml ?? "<p>No output generated.</p>", {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": "sandbox",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    return fail(err);
  }
}
