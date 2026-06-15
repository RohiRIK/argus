import { expect, test, describe } from "bun:test";
import {
  parseAdminConsentReturn,
  hasBootstrapScopes,
  BOOTSTRAP_SCOPES,
  buildConsentSetupSnippet,
  GRAPH_RESOURCE_APP_ID,
} from "../src/lib/graph-consent";

describe("parseAdminConsentReturn (Phase 2 redirect handling)", () => {
  test("success: admin_consent=True yields status success + tenant", () => {
    const r = parseAdminConsentReturn(new URLSearchParams("admin_consent=True&tenant=t-123"));
    expect(r).toEqual({ status: "success", tenant: "t-123" });
  });

  test("success is case-insensitive on the consent flag", () => {
    expect(parseAdminConsentReturn(new URLSearchParams("admin_consent=true")).status).toBe("success");
  });

  test("error: surfaces error + description", () => {
    const r = parseAdminConsentReturn(new URLSearchParams("error=access_denied&error_description=User+declined"));
    expect(r.status).toBe("error");
    expect(r.error).toBe("access_denied");
    expect(r.errorDescription).toBe("User declined");
  });

  test("error wins even if admin_consent is also present", () => {
    const r = parseAdminConsentReturn(new URLSearchParams("admin_consent=True&error=bad"));
    expect(r.status).toBe("error");
  });

  test("plain visit (no params) is none", () => {
    expect(parseAdminConsentReturn(new URLSearchParams("")).status).toBe("none");
  });

  test("admin_consent=False is not a success", () => {
    expect(parseAdminConsentReturn(new URLSearchParams("admin_consent=False")).status).toBe("none");
  });
});

describe("buildConsentSetupSnippet", () => {
  const scopes = ["User.Read.All", "Mail.Send", "Reports.Read.All"];

  test("includes clientId, every scope, the Graph resource id, and the Graph cmdlets", () => {
    const s = buildConsentSetupSnippet("client-abc", scopes);
    expect(s).toContain('$clientId = "client-abc"');
    for (const sc of scopes) expect(s).toContain(`"${sc}"`);
    expect(s).toContain(GRAPH_RESOURCE_APP_ID);
    expect(s).toContain("Connect-MgGraph");
    expect(s).toContain("New-MgServicePrincipalAppRoleAssignment");
  });

  test("falls back to placeholders when clientId/scopes are empty", () => {
    const s = buildConsentSetupSnippet("", []);
    expect(s).toContain("<your-app-client-id>");
    expect(s).toContain('"Mail.Send"'); // default scope so the snippet is still runnable
  });

  test("is multi-line PowerShell (no unresolved template artifacts)", () => {
    const s = buildConsentSetupSnippet("c", scopes);
    expect(s.split("\n").length).toBeGreaterThan(8);
    expect(s).not.toContain("undefined");
  });
});

describe("hasBootstrapScopes (Step 2 gating)", () => {
  test("true only when both bootstrap scopes present", () => {
    expect(hasBootstrapScopes([...BOOTSTRAP_SCOPES])).toBe(true);
  });

  test("false when one is missing", () => {
    expect(hasBootstrapScopes([BOOTSTRAP_SCOPES[0]])).toBe(false);
  });

  test("false on empty set, extra scopes ignored", () => {
    expect(hasBootstrapScopes([])).toBe(false);
    expect(hasBootstrapScopes([...BOOTSTRAP_SCOPES, "Mail.Send"])).toBe(true);
  });
});
