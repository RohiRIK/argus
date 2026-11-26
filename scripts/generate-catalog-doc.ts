import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReportCategory, ReportDefinition } from "@/services/reports/types";

/**
 * Render the generated reference section of docs/04-Guides/report-catalog.md
 * (report id / name / category / data source / required Graph permissions)
 * from the contract-tested runtime registry. Only the region between the
 * BEGIN/END markers is rewritten; the hand-written review tables stay intact.
 *
 *   bun run docs:catalog          # rewrite the generated section
 *   bun run docs:catalog --check  # fail when the doc has drifted (CI)
 */

const DOC_PATH = join(process.cwd(), "docs", "04-Guides", "report-catalog.md");
export const BEGIN_MARKER = "<!-- BEGIN GENERATED: report-catalog (bun run docs:catalog) -->";
export const END_MARKER = "<!-- END GENERATED: report-catalog -->";

const CATEGORY_ORDER: ReportCategory[] = ["identity", "security", "infrastructure", "custom"];
const CATEGORY_LABEL: Record<ReportCategory, string> = {
  identity: "Identity",
  security: "Security",
  infrastructure: "Infrastructure",
  custom: "Custom",
};

const cell = (v: string) => v.replace(/\|/g, "\\|");

export function renderCatalogSection(reports: ReportDefinition<object>[]): string {
  const lines: string[] = [
    BEGIN_MARKER,
    "<!-- Do not edit by hand: regenerate with `bun run docs:catalog`. -->",
    "",
    `**${reports.length} built-in reports** registered and contract-tested (\`bun run plugin:validate\`).`,
    "",
  ];

  for (const category of CATEGORY_ORDER) {
    const inCategory = reports.filter((r) => r.category === category);
    if (inCategory.length === 0) continue;
    lines.push(
      `### ${CATEGORY_LABEL[category]} (${inCategory.length})`,
      "",
      "| Report | id | Data source | Maturity | Required Graph permissions |",
      "|---|---|---|---|---|",
    );
    for (const r of inCategory) {
      const perms = r.requiredPermissions.map((p) => `\`${cell(p)}\``).join(", ") || "—";
      lines.push(
        `| ${cell(r.name)} | \`${r.id}\` | ${r.dataSource ?? "—"} | ${r.maturity ?? "stable"} | ${perms} |`,
      );
    }
    lines.push("");
  }

  const allScopes = [
    ...new Set(reports.flatMap((r) => r.requiredPermissions).filter((p) => !p.startsWith("("))),
  ].sort();
  lines.push(
    "### Application permissions (union)",
    "",
    "Read-only Microsoft Graph **application** permissions needed to run every built-in report",
    "(dispatch additionally needs `Mail.Send` — see SETUP.md):",
    "",
    ...allScopes.map((s) => `- \`${s}\` — ${reports.filter((r) => r.requiredPermissions.includes(s)).map((r) => `\`${r.id}\``).join(", ")}`),
    "",
    END_MARKER,
  );
  return lines.join("\n");
}

export function applyCatalogSection(doc: string, section: string): string {
  const start = doc.indexOf(BEGIN_MARKER);
  const end = doc.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`report-catalog.md must contain the markers:\n${BEGIN_MARKER}\n${END_MARKER}`);
  }
  return doc.slice(0, start) + section + doc.slice(end + END_MARKER.length);
}

async function main() {
  // Exclude per-deployment declarative plugins so the doc is deterministic.
  process.env.ARGUS_PLUGINS_DIR = join(process.cwd(), ".no-runtime-plugins");
  const { listReports } = await import("@/services/reports/registry");
  const reports = listReports().filter((r) => r.source === "builtin");

  const checkOnly = process.argv.includes("--check");
  const current = existsSync(DOC_PATH) ? readFileSync(DOC_PATH, "utf8") : "";
  const next = applyCatalogSection(current, renderCatalogSection(reports));

  if (checkOnly) {
    if (next !== current) {
      console.error("[docs] report-catalog.md is out of date. Run: bun run docs:catalog");
      process.exit(1);
    }
    console.log(`[docs] report-catalog.md up to date (${reports.length} reports).`);
    return;
  }
  writeFileSync(DOC_PATH, next, "utf8");
  console.log(`[docs] Regenerated ${DOC_PATH} (${reports.length} reports).`);
}

if (import.meta.main) await main();
