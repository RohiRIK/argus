import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));
const kind = args.find((a) => a.startsWith("--kind="))?.split("=")[1] ?? "report";
const categoryArg =
  args.find((a) => a.startsWith("--category="))?.split("=")[1] ?? (kind === "automation" ? "identity" : "security");

if (!id || !/^[a-z0-9][a-z0-9-]{2,48}$/.test(id) || !["report", "automation"].includes(kind)) {
  console.error(
    "Usage: bun run plugin:new <kebab-case-id> [--kind=report|automation] [--category=...]\n" +
      "  report categories:     identity | security | infrastructure | custom\n" +
      "  automation categories: conditional-access | identity | security | licensing | governance | devices",
  );
  process.exit(1);
}

if (kind === "automation") {
  scaffoldAutomation(id, categoryArg);
  process.exit(0);
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
  service: "Microsoft 365",
  icon: "graph",
  dataSource: "graph-v1",
  metrics: ["Total records"],
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

/**
 * Scaffold an automation plugin in src/services/automations/catalog/custom/<id>.ts
 * and register it in catalog/custom/index.ts. The template passes the automation
 * contract as-is; edit plan()/apply()/requiredPermissions, then run
 * `bun run plugin:validate` and `bun test tests/automation-contract.test.ts`.
 */
function scaffoldAutomation(automationId: string, category: string): void {
  const categories = ["conditional-access", "identity", "security", "licensing", "governance", "devices"];
  if (!categories.includes(category)) {
    console.error(`Invalid automation category "${category}". Must be one of: ${categories.join(", ")}.`);
    process.exit(1);
  }
  const customDir = join(process.cwd(), "src", "services", "automations", "catalog", "custom");
  const file = join(customDir, `${automationId}.ts`);
  if (existsSync(file)) {
    console.error(`Automation already exists: ${file}`);
    process.exit(1);
  }
  const title = automationId.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const exportName = automationId.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase()) + "Automation";

  writeFileSync(
    file,
    `import type { AutomationDefinition, PlannedAutomationAction } from "../../types";

interface GuestUser {
  id: string;
  userPrincipalName?: string;
  accountEnabled?: boolean;
}

/**
 * ${title}. Rules (checked by the automation contract in CI):
 *  - plan() only reads (transport.get / getOne) and describes each change;
 *  - apply() makes exactly the planned change and returns a rollbackPayload when reversible;
 *  - requiredPermissions lists every Graph application permission used (read + write);
 *  - riskLevel "high" must recommend "audit"; privileged scopes can't be "low".
 */
export const ${exportName}: AutomationDefinition = {
  apiVersion: "argus.automation/v1",
  id: "${automationId}",
  version: "1.0.0",
  name: "${title}",
  category: "${category}",
  riskLevel: "high",
  description: "Describe what this automation changes in the tenant, which objects it targets and how to undo it.",
  requiredPermissions: ["User.ReadWrite.All"],
  recommendedSchedule: "weekly",
  recommendedMode: "audit",
  service: "Microsoft Entra ID",
  icon: "entra",
  dataSource: "graph-v1",
  tags: ["${category}"],
  // pairedReportId: "<report id from the catalog this automation acts on>",
  paramSchema: [
    {
      key: "excludedUpns",
      label: "Excluded accounts",
      type: "string_list",
      description: "User principal names that are never changed.",
      defaultValue: [],
    },
  ],

  async plan(transport, params) {
    const excluded = new Set(((params.excludedUpns as string[]) ?? []).map((u) => u.toLowerCase()));
    const res = await transport.get<GuestUser>(
      "/users?$filter=userType eq 'Guest' and accountEnabled eq true&$select=id,userPrincipalName,accountEnabled&$top=999",
    );
    const actions: PlannedAutomationAction[] = [];
    for (const u of res.value) {
      const label = u.userPrincipalName ?? u.id;
      if (excluded.has(label.toLowerCase())) continue;
      actions.push({
        targetType: "user",
        targetId: u.id,
        targetLabel: label,
        actionType: "disable_user",
        reason: "Replace with the condition this automation enforces",
        beforeState: { accountEnabled: true },
        plannedAfterState: { accountEnabled: false },
        rollbackPayload: {
          method: "PATCH",
          path: \`/users/\${u.id}\`,
          body: { accountEnabled: true },
          description: \`Re-enable "\${label}"\`,
        },
      });
    }
    return {
      evaluatedCount: res.value.length,
      summary: actions.length ? \`\${actions.length} account(s) to change.\` : "Nothing to change.",
      actions,
    };
  },

  async apply(transport, action) {
    await transport.patch(\`/users/\${action.targetId}\`, { accountEnabled: false });
    return { afterState: { accountEnabled: false }, rollbackPayload: action.rollbackPayload ?? null };
  },
};
`,
    "utf8",
  );

  const indexPath = join(customDir, "index.ts");
  let index = readFileSync(indexPath, "utf8");
  index = index
    .replace(
      "// plugin:new imports (do not remove this marker)",
      `import { ${exportName} } from "./${automationId}";\n// plugin:new imports (do not remove this marker)`,
    )
    .replace(
      "  // plugin:new entries (do not remove this marker)",
      `  ${exportName},\n  // plugin:new entries (do not remove this marker)`,
    );
  writeFileSync(indexPath, index, "utf8");
  console.log(
    `[plugins] Scaffolded src/services/automations/catalog/custom/${automationId}.ts and registered it.\n` +
      "Edit plan()/apply()/requiredPermissions, then run: bun run plugin:validate && bun test tests/automation-contract.test.ts",
  );
}
