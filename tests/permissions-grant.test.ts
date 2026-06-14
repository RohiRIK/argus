import { expect, test, describe } from "bun:test";
import {
  adminConsentUrl,
  mapScopesToRoleIds,
  buildRequiredResourceAccess,
  GRAPH_APP_ID,
} from "../src/services/graph/permissions-grant";

describe("permission grant helpers (C6)", () => {
  test("adminConsentUrl builds the tenant admin-consent URL", () => {
    const u = adminConsentUrl("tenant-1", "client-1", "https://argus.local/settings/integrations");
    expect(u).toContain("https://login.microsoftonline.com/tenant-1/adminconsent");
    expect(u).toContain("client_id=client-1");
    expect(u).toContain(encodeURIComponent("https://argus.local/settings/integrations"));
  });

  test("mapScopesToRoleIds resolves names to ids, skips unknown", () => {
    const roles = [{ id: "a", value: "Mail.Send" }, { id: "b", value: "User.Read.All" }];
    expect(mapScopesToRoleIds(roles, ["User.Read.All", "Nope"])).toEqual([{ id: "b", value: "User.Read.All" }]);
  });

  test("buildRequiredResourceAccess merges + dedupes graph roles", () => {
    const existing = [{ resourceAppId: GRAPH_APP_ID, resourceAccess: [{ id: "x", type: "Role" }] }];
    const out = buildRequiredResourceAccess(existing, GRAPH_APP_ID, ["x", "y"]);
    const graph = out.find((e) => e.resourceAppId === GRAPH_APP_ID)!;
    expect(graph.resourceAccess.map((r) => r.id).sort()).toEqual(["x", "y"]);
  });

  test("buildRequiredResourceAccess adds a graph entry when absent", () => {
    const out = buildRequiredResourceAccess([], GRAPH_APP_ID, ["z"]);
    expect(out).toHaveLength(1);
    expect(out[0].resourceAccess[0]).toEqual({ id: "z", type: "Role" });
  });
});
