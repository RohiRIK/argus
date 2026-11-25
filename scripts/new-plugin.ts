import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));
const categoryArg = args.find((a) => a.startsWith("--category="))?.split("=")[1] ?? "security";

if (!id || !/^[a-z0-9][a-z0-9-]{2,48}$/.test(id)) {
  console.error("Usage: bun run plugin:new <kebab-case-id> [--category=identity|security|infrastructure|custom]");
  process.exit(1);
}

if (!["identity", "security", "infrastructure", "custom"].includes(categoryArg)) {
  console.error(`Invalid category "${categoryArg}". Must be identity, security, infrastructure, or custom.`);
  process.exit(1);
}

const dir = join(process.cwd(), "src", "plugins", "reports", id);
if (existsSync(dir)) {
  console.error(`Plugin directory already exists: ${dir}`);
  process.exit(1);
}

const title = id
  .split("-")
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  .join(" ");

mkdirSync(dir, { recursive: true });

writeFileSync(
  join(dir, "plugin.ts"),
  `import { defineReportPlugin } from "@/plugins/sdk";
import type { ReportSummary } from "@/services/reports/types";

interface SampleRow {
  id: string;
  displayName?: string;
}

export const plugin = defineReportPlugin<SampleRow>({
  id: "${id}",
  version: "1.0.0",
  name: "${title}",
  category: "${categoryArg}",
  description: "Describe what Microsoft 365 signal this report tracks.",
  requiredPermissions: ["Directory.Read.All"],
  baselineSupport: true,
  tags: ["${categoryArg}"],
  recommendedSchedule: "weekly",
  recommendedGroup: "Argus - M365 Operations",
  rowKey: (row) => String(row.id),
  async fetch(transport) {
    return (await transport.get<SampleRow>("/organization?$top=100&$select=id,displayName")).value;
  },
  summarize(rows): ReportSummary {
    return {
      count: rows.length,
      variables: {
        totalRecords: rows.length,
      },
      rows: rows.slice(0, 50).map((r) => ({
        id: r.id,
        name: r.displayName ?? "—",
      })),
    };
  },
});
`,
  "utf8",
);

writeFileSync(
  join(dir, "fixtures.json"),
  JSON.stringify(
    {
      rows: [{ id: "sample-1", displayName: "Sample Item" }],
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

writeFileSync(
  join(dir, "plugin.test.ts"),
  `import { describe, expect, test } from "bun:test";
import { plugin } from "./plugin";
import fixtures from "./fixtures.json";

describe("${id} plugin", () => {
  test("summarizes fixture rows cleanly", () => {
    const summary = plugin.summarize(fixtures.rows);
    expect(summary.count).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(summary.rows)).toBe(true);
  });
});
`,
  "utf8",
);

spawnSync("bun", ["run", "scripts/generate-plugin-registry.ts"], { stdio: "inherit" });
console.log(`[plugins] Scaffolded src/plugins/reports/${id}/ (edit plugin.ts & fixtures.json, then run bun run plugin:validate)`);
