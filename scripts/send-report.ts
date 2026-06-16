/**
 * Manual end-to-end send: run ONE report live, render it, email it.
 * Run: `bun scripts/send-report.ts <report-id> <recipient-email>`
 * Uses the same render + transport + from-address resolution as the executor.
 */
import { getReport } from "../src/services/reports/registry";
import { liveGraphTransport } from "../src/services/graph/client";
import { renderReport, renderSubject, type RenderInput } from "../src/services/report-engine/default-template";
import { liveEmailTransport } from "../src/services/dispatch/email";
import { settingsDao } from "../src/db/dao/settings";
import { templatesDao } from "../src/db/dao/templates";
import { vaultService } from "../src/services/vault/vault";

const id = process.argv[2];
const to = process.argv[3];
if (!id || !to) {
  console.error("usage: bun scripts/send-report.ts <report-id> <recipient-email>");
  process.exit(1);
}

const report = getReport(id);
if (!report) {
  console.error(`no report with id "${id}"`);
  process.exit(1);
}

const rows = (await report.fetch(liveGraphTransport, {})) as never[];
const summary = report.summarize(rows);
const settings = settingsDao.get();
const template = templatesDao.defaultFor(id);

const renderInput: RenderInput = {
  reportName: report.name,
  organizationName: "your organization",
  category: report.category,
  executionId: `manual-${Date.now()}`,
  count: summary.count,
  executiveSummary: `${summary.count} item(s) detected. Manual verification send.`,
  trendPercent: 0,
  trendDirection: "flat",
  isAnomaly: false,
  baselineMean: 0,
  variables: summary.variables,
  rows: summary.rows,
};

const html = renderReport(renderInput, template?.htmlBody);
const subject = renderSubject(renderInput, template?.subject);
const from = settings.fromAddress || vaultService.get("mailbox") || "";
if (!from) {
  console.error("No from-address: set Settings → From address, or a vault 'mailbox' value.");
  process.exit(1);
}

console.log(`from=${from}  to=${to}`);
console.log(`subject=${subject}`);
console.log(`rows=${summary.rows?.length ?? 0}  count=${summary.count}`);
console.log(`sample=${JSON.stringify((summary.rows ?? []).slice(0, 3))}`);

await liveEmailTransport.send({ from, to: [to], subject, html, replyTo: settings.replyTo ?? undefined });
console.log("✓ SENT");
process.exit(0);
