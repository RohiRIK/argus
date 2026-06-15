import { expect, test, describe } from "bun:test";
import { parseAdminConsentReturn, hasBootstrapScopes, BOOTSTRAP_SCOPES } from "../src/lib/graph-consent";

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
