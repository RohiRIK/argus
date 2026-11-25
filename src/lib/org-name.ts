import { GUID_RE } from "./validation";

export interface ResolveOrgNameOptions {
  settingsOrgName?: string | null;
  tenantDisplayName?: unknown;
  primaryDomain?: unknown;
  fallback?: string;
}

/**
 * Resolve the human-facing organization display name:
 * 1. Explicit override saved in Settings -> General
 * 2. Entra ID tenant displayName (if non-empty and not a raw tenant GUID)
 * 3. Primary verified domain (e.g. "rohi-lab.org")
 * 4. Raw tenantDisplayName (even if GUID) or safe fallback
 */
export function resolveOrganizationName(opts: ResolveOrgNameOptions): string {
  const custom = opts.settingsOrgName?.trim();
  if (custom) return custom;

  const tenant = typeof opts.tenantDisplayName === "string" ? opts.tenantDisplayName.trim() : "";
  const domain = typeof opts.primaryDomain === "string" ? opts.primaryDomain.trim() : "";

  if (tenant && !GUID_RE.test(tenant)) return tenant;
  if (domain) return domain;
  if (tenant) return tenant;
  return opts.fallback ?? "your organization";
}
