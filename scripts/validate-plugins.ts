import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BUILTIN_PLUGINS_DIR,
  DECLARATIVE_EXAMPLES_DIR,
  checkBuiltinFolder,
  collectDeclarativeDirTargets,
  collectRegistryTargets,
  listBuiltinPluginFolders,
  runContracts,
  type PluginContractResult,
} from "@/services/reports/plugin-contract";
import { listReports } from "@/services/reports/registry";
import { generateRegistrySource } from "./generate-plugin-registry";

/**
 * CI plugin gate (`bun run plugin:validate`). Every rule lives in the shared
 * `src/services/reports/plugin-contract.ts` module (also used by
 * `tests/plugin-contract.test.ts`). Covers:
 *  - registry.generated.ts drift + built-in folder ↔ registry parity,
 *  - source security scan for each built-in folder,
 *  - the fixture contract for EVERY report the runtime registry exposes
 *    (built-ins + declarative plugins from ARGUS_PLUGINS_DIR / ./data/plugins),
 *  - the shipped declarative examples in ./examples/plugins.
 */

const GENERATED_REGISTRY = join(process.cwd(), "src", "services", "reports", "registry.generated.ts");

async function main() {
  const errors: string[] = [];

  // 1. registry.generated.ts has zero drift
  const { folders: registryFolders, source } = generateRegistrySource();
  const currentRegistry = existsSync(GENERATED_REGISTRY) ? readFileSync(GENERATED_REGISTRY, "utf8") : "";
  if (currentRegistry !== source) {
    errors.push("registry.generated.ts is out of sync with src/plugins/reports/* (run `bun run plugin:sync`)");
  }

  if (!existsSync(BUILTIN_PLUGINS_DIR)) {
    console.error("[plugins] Missing directory:", BUILTIN_PLUGINS_DIR);
    process.exit(1);
  }

  // 2. Built-in folder files + security scan; every folder must be a registered built-in
  const folders = listBuiltinPluginFolders();
  const builtinIds = new Set(listReports().filter((r) => r.source !== "declarative").map((r) => r.id));
  for (const folder of folders) {
    errors.push(...checkBuiltinFolder(folder));
    if (!builtinIds.has(folder)) errors.push(`${folder}: not exposed by the runtime registry (id must match folder name)`);
  }

  // 3. Contract for every registered report (built-in + runtime declarative)
  const registry = collectRegistryTargets();
  errors.push(...registry.errors);
  const registryRun = await runContracts(registry.targets);
  errors.push(...registryRun.errors);

  // 4. Shipped declarative examples (contract parity + no collision with built-ins)
  const examples = collectDeclarativeDirTargets(DECLARATIVE_EXAMPLES_DIR);
  errors.push(...examples.errors);
  const exampleRun = await runContracts(examples.targets);
  errors.push(...exampleRun.errors);
  for (const r of exampleRun.results) {
    if (builtinIds.has(r.id)) errors.push(`${r.label}: example id "${r.id}" collides with a built-in report`);
  }

  const results: PluginContractResult[] = [...registryRun.results, ...exampleRun.results];
  const status = (r: PluginContractResult) => (r.errors.length === 0 ? "PASS" : "FAIL");

  console.log(
    `[plugins] Validated ${results.length} report plugin(s) ` +
      `(built-in registry entries: ${registryFolders.length}, declarative examples: ${exampleRun.results.length}).`,
  );
  for (const r of results) {
    const scopes = r.requiredPermissions.join(", ") || "none";
    console.log(
      `  ${status(r) === "PASS" ? "✓" : "✗"} ${r.id.padEnd(28)} v${r.version.padEnd(8)} ${r.category.padEnd(15)} ${r.source.padEnd(11)} [${scopes}]`,
    );
  }

  const ghSummary = process.env.GITHUB_STEP_SUMMARY;
  if (ghSummary) {
    const md = [
      `## Argus Report Plugins Security & Contract Check (${results.length} plugins)`,
      "",
      "| Plugin ID | Source | Version | Category | Read-Only Scopes | Status |",
      "| :--- | :--- | :--- | :--- | :--- | :--- |",
      ...results.map(
        (r) =>
          `| \`${r.id}\` | ${r.source} | ${r.version} | ${r.category} | \`${r.requiredPermissions.join(", ") || "none"}\` | ${status(r)} |`,
      ),
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
