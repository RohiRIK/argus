import { listReports, getQuarantinedPlugins } from "@/services/reports/registry";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/catalog — available report plugins with metadata (PRD §10). */
export async function GET() {
  try {
    const catalog = listReports().map((r) => ({
      id: r.id,
      version: r.version ?? "1.0.0",
      name: r.name,
      category: r.category,
      description: r.description,
      requiredPermissions: r.requiredPermissions,
      baselineSupport: r.baselineSupport,
      tags: r.tags ?? [],
      maturity: r.maturity ?? "stable",
      recommendedSchedule: r.recommendedSchedule ?? "weekly",
      recommendedGroup: r.recommendedGroup ?? null,
      usageConcealmentNote: Boolean(r.usageConcealmentNote),
      source: r.source ?? "builtin",
    }));
    const quarantined = getQuarantinedPlugins();
    return ok(catalog, {
      total: catalog.length,
      ...(quarantined.length ? { quarantinedCount: quarantined.length } : {}),
    });
  } catch (err) {
    return fail(err);
  }
}
