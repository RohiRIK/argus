import { executionsDao } from "@/db/dao/executions";
import { fail } from "@/lib/api";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { executionToCsv } from "@/lib/export";

export const dynamic = "force-dynamic";

/**
 * GET /api/executions/:id/download?format=html|csv — download the stored report
 * as a rendered HTML file or the run's data as CSV (Content-Disposition attachment).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const format = new URL(req.url).searchParams.get("format") ?? "html";
    const execution = executionsDao.findById(id);
    if (!execution) throw new NotFoundError(`Execution ${id} not found`);

    const short = id.slice(0, 8);
    if (format === "csv") {
      return new Response(executionToCsv(execution), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="argus-execution-${short}.csv"`,
        },
      });
    }
    if (format === "html") {
      return new Response(execution.outputHtml ?? "<p>No output generated.</p>", {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-disposition": `attachment; filename="argus-execution-${short}.html"`,
        },
      });
    }
    throw new ValidationError(`Unsupported format "${format}" (use html or csv).`);
  } catch (err) {
    return fail(err);
  }
}
