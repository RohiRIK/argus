import { vaultService } from "@/services/vault/vault";
import { listEntraGroups, listEntraUsers } from "@/services/graph/groups";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/directory?kind=users|groups&q=... — search Entra directory for UI pickers. */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind") === "groups" ? "groups" : "users";
    const q = url.searchParams.get("q") ?? "";

    if (!vaultService.isConfigured()) {
      return ok({ connected: false, items: [] });
    }

    const items = kind === "groups" ? await listEntraGroups(q) : await listEntraUsers(q);
    return ok({ connected: true, items }, { total: items.length });
  } catch (err) {
    return fail(err);
  }
}
