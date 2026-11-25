import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listReports, getQuarantinedPlugins, getReport, reloadReports } from "../src/services/reports/registry";
import { BUILTIN_REPORT_PLUGINS } from "../src/services/reports/registry.generated";
import { isAllowedReadOnlyPermission, scanPluginSource, validatePlugin } from "../src/plugins/security";
import { loadDeclarativePlugins } from "../src/plugins/declarative";

const PLUGINS_ROOT = join(process.cwd(), "src", "plugins", "reports");

describe("Plugin SDK, Security Sandbox & Fixture Contracts", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    delete process.env.ARGUS_PLUGINS_DIR;
    reloadReports();
    for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  test("all built-in plugins pass schema, folder-id, security scan, and fixture contracts", async () => {
    const folders = readdirSync(PLUGINS_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    expect(folders.length).toBeGreaterThanOrEqual(26);
    expect(BUILTIN_REPORT_PLUGINS.length).toBe(folders.length);
    expect(getQuarantinedPlugins()).toEqual([]);

    for (const folder of folders) {
      const folderPath = join(PLUGINS_ROOT, folder);
      const pluginPath = join(folderPath, "plugin.ts");
      const fixturePath = join(folderPath, "fixtures.json");

      expect(existsSync(pluginPath)).toBe(true);
      expect(existsSync(fixturePath)).toBe(true);

      for (const file of readdirSync(folderPath)) {
        if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
        const src = readFileSync(join(folderPath, file), "utf8");
        expect(scanPluginSource(src, file)).toEqual([]);
      }

      const mod = (await import(pluginPath)) as { plugin?: unknown; default?: unknown };
      const check = validatePlugin(mod.plugin ?? mod.default, folder);
      expect(check.ok).toBe(true);
      if (!check.ok) continue;

      const plugin = check.plugin;
      expect(typeof plugin.service).toBe("string");
      expect(plugin.service!.length).toBeGreaterThanOrEqual(2);
      expect(typeof plugin.icon).toBe("string");
      expect(typeof plugin.dataSource).toBe("string");
      expect(Array.isArray(plugin.metrics)).toBe(true);
      expect(plugin.metrics!.length).toBeGreaterThanOrEqual(2);
      const rawFixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
        params?: Record<string, unknown>;
        rows?: unknown[];
        csvRows?: Record<string, string>[];
      };
      const transport = {
        async get<T = unknown>() {
          return { value: (rawFixture.rows ?? []) as T[], latencyMs: 1 };
        },
        async batch() {
          return [];
        },
        async getCsv() {
          const rows = (rawFixture.csvRows ?? rawFixture.rows ?? []) as Record<string, string>[];
          return { headers: Object.keys(rows[0] ?? {}), rows, latencyMs: 1 };
        },
      };

      const fetched = await plugin.fetch(transport, rawFixture.params ?? {});
      const summary = plugin.summarize(fetched);
      const empty = plugin.summarize([]);

      expect(Number.isInteger(summary.count)).toBe(true);
      expect(summary.count).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(empty.count)).toBe(true);
      expect(empty.count).toBeGreaterThanOrEqual(0);
      expect(summary.rows?.length ?? 0).toBeLessThanOrEqual(50);

      for (const v of Object.values(summary.variables)) {
        expect(typeof v === "string" || (typeof v === "number" && Number.isFinite(v))).toBe(true);
      }
    }

    expect(listReports().length).toBe(folders.length);
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
