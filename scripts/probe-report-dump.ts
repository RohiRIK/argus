/**
 * Dev probe: dump LIVE columns + sample rows for ONE report, so we can see the
 * real CSV headers and whether identity fields are concealed by the tenant.
 * Run: `bun scripts/probe-report-dump.ts <report-id>` (ARGUS_MASTER_KEY from .env).
 */
import { listReports } from "../src/services/reports/registry";
import { liveGraphTransport } from "../src/services/graph/client";

const id = process.argv[2];
const r = listReports().find((x) => x.id === id);
if (!r) {
  console.error(`no report with id "${id}". Available: ${listReports().map((x) => x.id).join(", ")}`);
  process.exit(1);
}

const rows = (await r.fetch(liveGraphTransport, {})) as Record<string, string>[];
console.log(`REPORT: ${r.id}  (${r.name})`);
console.log(`ROWS: ${rows.length}`);
console.log(`HEADERS: ${JSON.stringify(Object.keys(rows[0] ?? {}))}`);
console.log(`SAMPLE (first 3 raw rows):\n${JSON.stringify(rows.slice(0, 3), null, 2)}`);

const summary = r.summarize(rows as never[]);
console.log(`\nSUMMARY count=${summary.count}`);
console.log(`SUMMARY rows (first 5):\n${JSON.stringify((summary.rows ?? []).slice(0, 5), null, 2)}`);
process.exit(0);
