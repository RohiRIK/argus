import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReportPlugin } from "@/services/reports/types";
import { scanPluginSource, validatePlugin } from "@/plugins/security";
import { generateRegistrySource } from "./generate-plugin-registry";

const ROOT = process.cwd();
const PLUGINS_DIR = join(ROOT, "src", "plugins", "reports");
const GENERATED_REGISTRY = join(ROOT, "src", "services", "reports", "registry.generated.ts");

interface FixtureFile {
  params?: Record<string, unknown>;
  rows?: unknown[];
  csvRows?: Record<string, string>[];
}

function loadFixtures(filePath: string): { params: Record<string, unknown>; rows: unknown[]; csvRows?: Record<string, string>[] } {
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (Array.isArray(raw)) {
    return { params: {}, rows: raw };
  }
  const obj = raw as FixtureFile;
  return {
    params: obj.params ?? {},
    rows: Array.isArray(obj.rows) ? obj.rows : Array.isArray(obj.csvRows) ? obj.csvRows : [],
    csvRows: obj.csvRows,
  };
}

async function main() {
  const errors: string[] = [];
  const summaryRows: Array<{ id: string; version: string; category: string; scopes: string; status: string }> = [];

  // 1. Verify registry.generated.ts has zero drift
  const { folders, source } = generateRegistrySource();
  const currentRegistry = existsSync(GENERATED_REGISTRY) ? readFileSync(GENERATED_REGISTRY, "utf8") : "";
  if (currentRegistry !== source) {
    errors.push("registry.generated.ts is out of sync with src/plugins/reports/* (run `bun run plugin:sync`)");
  }

  if (!existsSync(PLUGINS_DIR)) {
    console.error("[plugins] Missing directory:", PLUGINS_DIR);
    process.exit(1);
  }

  const dirs = readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const seenIds = new Set<string>();

  for (const folder of dirs) {
    const folderPath = join(PLUGINS_DIR, folder);
    const pluginTs = join(folderPath, "plugin.ts");
    const fixturesJson = join(folderPath, "fixtures.json");

    if (!existsSync(pluginTs)) {
      errors.push(`${folder}: missing plugin.ts`);
      continue;
    }
    if (!existsSync(fixturesJson)) {
      errors.push(`${folder}: missing fixtures.json`);
      continue;
    }

    // 2. Security source scan across every non-test .ts file in folder
    for (const file of readdirSync(folderPath)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      const src = readFileSync(join(folderPath, file), "utf8");
      const scanErrors = scanPluginSource(src, `src/plugins/reports/${folder}/${file}`);
      errors.push(...scanErrors);
    }

    // 3. Manifest & read-only permission validation
    let mod: Record<string, unknown>;
    try {
      mod = (await import(pluginTs)) as Record<string, unknown>;
    } catch (err) {
      errors.push(`${folder}: failed to import plugin.ts (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    const candidate = mod.plugin ?? mod.default;
    const validation = validatePlugin(candidate, folder);
    if (!validation.ok) {
      for (const e of validation.errors) errors.push(`${folder}: ${e}`);
      continue;
    }

    const plugin = validation.plugin as ReportPlugin<unknown>;
    if (seenIds.has(plugin.id)) {
      errors.push(`${folder}: duplicate plugin id "${plugin.id}"`);
      continue;
    }
    seenIds.add(plugin.id);

    // 4. Contract test: fetch + summarize against fixtures.json and empty []
    try {
      const fixture = loadFixtures(fixturesJson);
      const transport = {
        async get<T = unknown>() {
          return { value: fixture.rows as T[], latencyMs: 1 };
        },
        async batch() {
          return [];
        },
        async getCsv() {
          const rows = (fixture.csvRows ?? fixture.rows) as Record<string, string>[];
          return { headers: Object.keys(rows[0] ?? {}), rows, latencyMs: 1 };
        },
      };

      const fetched = await plugin.fetch(transport, fixture.params);
      const summary = plugin.summarize(fetched);
      const emptySummary = plugin.summarize([]);

      if (!Number.isInteger(summary.count) || summary.count < 0) {
        errors.push(`${folder}: summary.count must be a non-negative integer (got ${summary.count})`);
      }
      if (!Number.isInteger(emptySummary.count) || emptySummary.count < 0) {
        errors.push(`${folder}: empty summarize([]) count must be non-negative integer`);
      }
      if ((summary.rows?.length ?? 0) > 50) {
        errors.push(`${folder}: summary.rows exceeds 50-row cap (${summary.rows?.length})`);
      }
      for (const [k, v] of Object.entries(summary.variables)) {
        if (typeof v !== "string" && (typeof v !== "number" || !Number.isFinite(v))) {
          errors.push(`${folder}: summary.variables["${k}"] must be string or finite number`);
        }
      }
      if (plugin.rowKey && summary.rows?.length) {
        const key = plugin.rowKey(summary.rows[0]);
        if (typeof key !== "string" || !key.trim()) {
          errors.push(`${folder}: rowKey returned empty key for first fixture row`);
        }
      }

      summaryRows.push({
        id: plugin.id,
        version: plugin.version,
        category: plugin.category,
        scopes: plugin.requiredPermissions.join(", ") || "none",
        status: "PASS",
      });
    } catch (err) {
      errors.push(`${folder}: fixture contract run failed (${err instanceof Error ? err.message : String(err)})`);
      summaryRows.push({
        id: folder,
        version: plugin.version,
        category: plugin.category,
        scopes: plugin.requiredPermissions.join(", "),
        status: "FAIL",
      });
    }
  }

  console.log(`[plugins] Validated ${summaryRows.length} report plugin(s) (registry entries: ${folders.length}).`);
  for (const r of summaryRows) {
    console.log(`  ${r.status === "PASS" ? "✓" : "✗"} ${r.id.padEnd(28)} v${r.version.padEnd(8)} ${r.category.padEnd(15)} [${r.scopes}]`);
  }

  const ghSummary = process.env.GITHUB_STEP_SUMMARY;
  if (ghSummary) {
    const md = [
      `## Argus Report Plugins Security & Contract Check (${summaryRows.length} plugins)`,
      "",
      "| Plugin ID | Version | Category | Read-Only Scopes | Status |",
      "| :--- | :--- | :--- | :--- | :--- |",
      ...summaryRows.map((r) => `| \`${r.id}\` | ${r.version} | ${r.category} | \`${r.scopes}\` | ${r.status} |`),
      "",
    ].join("\n");
    appendFileSync(ghSummary, md, "utf8");
  }

  if (errors.length > 0) {
    console.error("\n[plugins] Validation FAILED:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
}

await main();
