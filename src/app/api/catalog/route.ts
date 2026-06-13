import { listReports } from "@/services/reports/registry";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/catalog — available report types with metadata (PRD §10). */
export async function GET() {
  try {
    const catalog = listReports().map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      description: r.description,
      requiredPermissions: r.requiredPermissions,
      baselineSupport: r.baselineSupport,
    }));
    return ok(catalog, { total: catalog.length });
  } catch (err) {
    return fail(err);
  }
}
