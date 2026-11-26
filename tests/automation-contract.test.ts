import { describe, test, expect } from "bun:test";
import { listAutomations } from "../src/services/automations/registry";
import {
  checkAutomationBehaviour,
  checkAutomationStatic,
  runAutomationContracts,
} from "../src/services/automations/contract";
import { listReports } from "../src/services/reports/registry";
import type { AutomationDefinition } from "../src/services/automations/types";

// Every automation in the catalog must pass the plugin contract (CI gate).
describe("automation plugin contract", () => {
  test("every registered automation passes", async () => {
    const results = await runAutomationContracts(listAutomations());
    const failures = results.filter((r) => r.errors.length > 0).map((r) => `${r.id}: ${r.errors.join("; ")}`);
    expect(failures).toEqual([]);
    expect(results.length).toBeGreaterThan(0);
  });

  const base = listAutomations()[0]!;
  const reportIds = new Set(listReports().map((r) => r.id));

  test("rejects bad metadata", () => {
    const bad = { ...base, id: "Bad_ID", version: "1", riskLevel: "high", recommendedMode: "enforce", pairedReportId: "nope", requiredPermissions: ["User.Read.All"] } as AutomationDefinition;
    const errs = checkAutomationStatic(bad, reportIds).join("\n");
    expect(errs).toMatch(/kebab-case/);
    expect(errs).toMatch(/semver/);
    expect(errs).toMatch(/must recommend "audit"/);
    expect(errs).toMatch(/pairedReportId/);
    expect(errs).toMatch(/no write permission/);
  });

  test("a privileged scope can't be low risk", () => {
    const bad = { ...base, riskLevel: "low", recommendedMode: "audit", requiredPermissions: ["Application.ReadWrite.All"] } as AutomationDefinition;
    expect(checkAutomationStatic(bad, reportIds).join("\n")).toMatch(/can't be "low"/);
  });

  test("a plan() that writes is rejected", async () => {
    const sneaky = {
      ...base,
      async plan(t: Parameters<AutomationDefinition["plan"]>[0]) {
        await t.patch("/users/x", {});
        return { evaluatedCount: 0, summary: "x", actions: [] };
      },
    } as AutomationDefinition;
    expect((await checkAutomationBehaviour(sneaky)).join("\n")).toMatch(/write calls/);
  });

  test("malformed planned actions are rejected", async () => {
    const bad = {
      ...base,
      async plan() {
        return { evaluatedCount: 1, summary: "x", actions: [{ targetType: "", targetId: "1", targetLabel: "u", actionType: "a", reason: "r", beforeState: {}, rollbackPayload: { method: "PUT", path: "users", description: "" } }] };
      },
    } as unknown as AutomationDefinition;
    const errs = (await checkAutomationBehaviour(bad)).join("\n");
    expect(errs).toMatch(/targetType/);
    expect(errs).toMatch(/rollbackPayload/);
  });
});
