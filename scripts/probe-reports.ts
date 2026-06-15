/**
 * Dev probe: run every catalog report's fetch + summarize against the LIVE tenant
 * (creds from the vault; demo tenant). One line per report: ok/fail, rows, count, error.
 * Run from repo root: `bun scripts/probe-reports.ts` (ARGUS_MASTER_KEY auto-loaded from .env).
 * Optional arg = substring filter on report id.
 */
import { listReports } from "../src/services/reports/registry";
import { liveGraphTransport } from "../src/services/graph/client";

const filter = process.argv[2];
const reports = listReports().filter((r) => !filter || r.id.includes(filter));

const out: { id: string; ok: boolean; rows?: number; count?: number; error?: string }[] = [];
for (const r of reports) {
  try {
    const rows = await r.fetch(liveGraphTransport, {});
    const summary = r.summarize(rows as never[]);
    out.push({ id: r.id, ok: true, rows: rows.length, count: summary.count });
  } catch (err) {
    out.push({ id: r.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

const pass = out.filter((o) => o.ok).length;
for (const o of out) {
  if (o.ok) console.log(`✓ ${o.id.padEnd(34)} rows=${o.rows} count=${o.count}`);
  else console.log(`✗ ${o.id.padEnd(34)} ${o.error?.slice(0, 160)}`);
}
console.log(`\n${pass}/${out.length} reports OK`);
process.exit(0);
