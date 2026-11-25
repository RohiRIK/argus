import { z } from "zod";
import type { ReportPlugin } from "@/services/reports/types";
import { PLUGIN_API_VERSION } from "./sdk";

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{2,48}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(-[a-z0-9.-]+)?$/;
const READ_ONLY_SCOPE_RE = /^[A-Za-z][A-Za-z0-9]*\.Read(?:Basic)?\.[A-Za-z][A-Za-z0-9]*$/;
const PRIVILEGED_SCOPE_RE = /ReadWrite|Mail\.Send|RoleManagement|AccessAsUser|\.Manage|Write/i;

export const pluginManifestSchema = z.object({
  apiVersion: z.literal(PLUGIN_API_VERSION),
  id: z.string().regex(PLUGIN_ID_RE, "Plugin id must be 3-49 chars lowercase kebab-case"),
  version: z.string().regex(SEMVER_RE, "Plugin version must follow semver (e.g. 1.0.0)"),
  name: z.string().min(2).max(80),
  description: z.string().min(10).max(500),
  category: z.enum(["identity", "security", "infrastructure", "custom"]),
  requiredPermissions: z.array(z.string().min(1)),
  baselineSupport: z.boolean(),
  maturity: z.enum(["stable", "preview"]).optional(),
  tags: z.array(z.string().min(1).max(32)).optional(),
  recommendedSchedule: z.enum(["hourly", "daily", "weekly"]).optional(),
  recommendedGroup: z.string().min(1).max(80).optional(),
  usageConcealmentNote: z.boolean().optional(),
});

/**
 * Enforce read-only Graph permission boundaries for catalog report plugins.
 * Prevents a report plugin from escalating privileges with write/mail/role scopes.
 */
export function isAllowedReadOnlyPermission(scope: string, pluginId: string): boolean {
  if (scope === "(depends on endpoint)") {
    return pluginId === "manual-graph-query";
  }
  if (PRIVILEGED_SCOPE_RE.test(scope)) return false;
  return READ_ONLY_SCOPE_RE.test(scope);
}

export type PluginValidationResult =
  | { ok: true; plugin: ReportPlugin<object> }
  | { ok: false; errors: string[] };

/** Validate a report plugin object at build/CI time and on runtime registry load. */
export function validatePlugin(candidate: unknown, expectedFolderId?: string): PluginValidationResult {
  const errors: string[] = [];
  if (!candidate || typeof candidate !== "object") {
    return { ok: false, errors: ["Plugin export must be an object"] };
  }

  const parsed = pluginManifestSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join(".") || "manifest"}: ${issue.message}`);
    }
  } else {
    if (expectedFolderId && parsed.data.id !== expectedFolderId) {
      errors.push(`id "${parsed.data.id}" must match folder name "${expectedFolderId}"`);
    }
    for (const scope of parsed.data.requiredPermissions) {
      if (!isAllowedReadOnlyPermission(scope, parsed.data.id)) {
        errors.push(`Forbidden or non-read-only Graph scope "${scope}"`);
      }
    }
  }

  const obj = candidate as { fetch?: unknown; summarize?: unknown; rowKey?: unknown };
  if (typeof obj.fetch !== "function") errors.push("fetch(transport, params) must be a function");
  if (typeof obj.summarize !== "function") errors.push("summarize(rows) must be a function");
  if (obj.rowKey !== undefined && typeof obj.rowKey !== "function") {
    errors.push("rowKey(row) must be a function when provided");
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, plugin: candidate as ReportPlugin<object> };
}

const FORBIDDEN_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "node:fs import", re: /from\s+["'](?:node:)?fs["']|require\(["'](?:node:)?fs["']\)/ },
  { label: "child_process import", re: /from\s+["'](?:node:)?child_process["']|require\(["'](?:node:)?child_process["']\)/ },
  { label: "network module import (use GraphTransport)", re: /from\s+["'](?:node:)?(?:http|https|net|tls)["']/ },
  { label: "SQLite / FFI import", re: /from\s+["']bun:(?:sqlite|ffi)["']/ },
  { label: "Vault access from plugin", re: /@\/services\/vault/ },
  { label: "Direct DB access from plugin", re: /@\/db\// },
  { label: "Env access from plugin", re: /@\/config\/env|\bprocess\.env\b/ },
  { label: "Bun.spawn / shell execution", re: /\bBun\.spawn(?:Sync)?\b/ },
  { label: "Dynamic code execution (eval / new Function)", re: /\beval\s*\(|\bnew\s+Function\s*\(/ },
];

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Static security scanner for plugin source files under `src/plugins/reports/`.
 * Ensures report plugins stay pure, read-only, and cannot bypass GraphTransport
 * or read encrypted vault secrets / filesystem / environment variables.
 */
export function scanPluginSource(source: string, filePath: string): string[] {
  const code = stripComments(source);
  const violations: string[] = [];

  for (const rule of FORBIDDEN_PATTERNS) {
    if (rule.re.test(code)) {
      violations.push(`${filePath}: forbidden ${rule.label}`);
    }
  }

  // Flag standalone fetch(...) network calls while permitting the `async fetch(` method declaration.
  const withoutMethodDecl = code.replace(/\basync\s+fetch\s*\(/g, "");
  if (/(?:^|[=;,(\s])fetch\s*\(/m.test(withoutMethodDecl) || /\bglobalThis\.fetch\b/.test(withoutMethodDecl)) {
    violations.push(`${filePath}: direct fetch() call forbidden — use injected GraphTransport`);
  }

  return violations;
}
