import { baselinesDao } from "@/db/dao/baselines";
import { detectAnomaly, mean, stddev } from "@/services/report-engine/baseline";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/baselines/:jobId — baseline metrics + current stats for a job. */
export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await params;
    const history = baselinesDao.history(jobId, "count");
    const latest = history[0] ?? 0;
    return ok({
      metric: "count",
      sampleSize: history.length,
      mean: mean(history),
      stddev: stddev(history),
      latest,
      anomaly: detectAnomaly(latest, history.slice(1)),
      history,
    });
  } catch (err) {
    return fail(err);
  }
}
