import { describe, test, expect } from "bun:test";
import { extractVariables } from "../src/services/report-engine/template";
import {
  DEFAULT_SUBJECT,
  DEFAULT_TEMPLATE_HTML,
  DEFAULT_TEXT_TEMPLATE,
  buildRawFragments,
  buildVars,
  type RenderInput,
} from "../src/services/report-engine/default-template";
import {
  AUTOMATION_DEFAULT_HTML,
  AUTOMATION_DEFAULT_SUBJECT,
  AUTOMATION_DEFAULT_TEXT,
} from "../src/services/report-engine/automation-template";
import { renderAutomationRunHtml } from "../src/services/automations/helpers";
import { listAutomations } from "../src/services/automations/registry";

/**
 * Template plugin contract (CI gate): every shipped default template only uses
 * variables its renderer provides, so an edited or new default can't silently
 * render blanks.
 */
const sample: RenderInput = {
  reportName: "R",
  organizationName: "O",
  category: "security",
  executionId: "e",
  count: 1,
  executiveSummary: "s",
  trendPercent: 0,
  trendDirection: "flat",
  isAnomaly: true,
  baselineMean: 1,
  variables: {},
  rows: [{ a: 1 }],
  isFirstRun: false,
  addedCount: 1,
  removedCount: 0,
  totalCount: 1,
};

describe("template contract", () => {
  test("report default templates use only provided variables", () => {
    const provided = new Set([...Object.keys(buildVars(sample)), ...Object.keys(buildRawFragments(sample))]);
    for (const tpl of [DEFAULT_SUBJECT, DEFAULT_TEMPLATE_HTML, DEFAULT_TEXT_TEMPLATE]) {
      expect(extractVariables(tpl).filter((v) => !provided.has(v))).toEqual([]);
    }
  });

  test("automation default template uses only provided variables", () => {
    const provided = new Set([
      "organization_name", "policyName", "automationName", "modeLabel", "statusLabel", "outcomeLabel", "summary",
      "evaluatedCount", "plannedCount", "appliedCount", "failedCount", "runId", "catalogId", "catalogVersion",
      "timestamp", "actionsTable", "actionsText",
    ]);
    for (const tpl of [AUTOMATION_DEFAULT_SUBJECT, AUTOMATION_DEFAULT_HTML, AUTOMATION_DEFAULT_TEXT]) {
      expect(extractVariables(tpl).filter((v) => !provided.has(v))).toEqual([]);
    }
    // And the renderer leaves no unresolved tokens.
    const out = renderAutomationRunHtml({
      organizationName: "O",
      policyName: "P",
      definition: listAutomations()[0]!,
      run: { id: "r", mode: "audit", status: "success", startedAt: "t", evaluatedCount: 0, plannedCount: 0, appliedCount: 0, failedCount: 0, summaryText: "s" },
      actions: [],
    });
    expect(out.html + out.subject + out.text).not.toMatch(/\{\{/);
  });
});
