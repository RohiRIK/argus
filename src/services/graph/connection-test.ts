import { acquireToken } from "./auth";
import { getSharedGraphClient, requestIdFromError } from "./client";
import { vaultService } from "@/services/vault/vault";
import { settingsDao } from "@/db/dao/settings";
import { integrationsDao } from "@/db/dao/integrations";
import { listReports } from "@/services/reports/registry";
import { GUID_RE } from "@/lib/validation";

export interface TenantInfo {
  id?: string;
  displayName?: string;
  primaryDomain?: string;
  verifiedDomains?: string[];
}

export interface ConnectionTestResult {
  ok: boolean;
  authMode: "certificate" | "secret" | "none";
  tenant?: TenantInfo;
  appDisplayName?: string;
  steps: {
    auth: { ok: boolean; latencyMs?: number; error?: string; requestId?: string };
    // `readable` = could we actually enumerate granted permissions? When false
    // (no Application.Read.All yet), `missing` is unverified — the UI must say
    // "consent pending", not "everything is missing".
    permissions: { ok: boolean; readable: boolean; granted: string[]; missing: string[]; note?: string; error?: string; requestId?: string };
    mailbox: { ok: boolean; note?: string; error?: string };
  };
}

/**
 * Every application permission Argus actually needs: the union of every report's
 * `requiredPermissions` plus `Mail.Send` (required to deliver). `(depends on …)`
 * placeholders from the manual-query report are skipped.
 */
export function requiredScopes(): string[] {
  const set = new Set<string>(["Mail.Send", "Group.ReadWrite.All"]);
  for (const r of listReports()) {
    for (const p of r.requiredPermissions) if (!p.startsWith("(")) set.add(p);
  }
  return [...set].sort();
}

/** Pure set-difference so the contract is unit-testable without Graph. */
export function computeMissing(required: string[], granted: string[]): string[] {
  const g = new Set(granted);
  return required.filter((r) => !g.has(r));
}

function isForbidden(err: unknown): boolean {
  const e = err as { statusCode?: number; code?: string };
  return e?.statusCode === 403 || e?.code === "Authorization_RequestDenied";
}

/** Minimal Graph client shape so the probe is unit-testable with a fake. */
interface GraphClientLike {
  api(path: string): {
    filter(f: string): { select(s: string): { get(): Promise<{ value?: { id: string; displayName?: string }[] }> } };
    select(s: string): {
      get(): Promise<{
        value?: { id?: string; displayName?: string; verifiedDomains?: { name: string; isDefault?: boolean }[]; appRoleId?: string; resourceId?: string }[];
        appRoles?: { id: string; value: string }[];
      }>;
    };
  };
}

/** Injectable dependencies for `testConnection` — defaults wire the live token/client/vault. */
export interface TestConnectionDeps {
  acquireToken?: (opts?: { forceRefresh?: boolean }) => Promise<unknown>;
  client?: GraphClientLike;
  clientId?: string;
  mailbox?: string;
}

/**
 * Resolve the application permission **names** actually granted to our app's
 * service principal, via `appRoleAssignments` → resolving each `appRoleId` to a
 * name on the resource SP (Microsoft Graph). Needs `Application.Read.All`.
 */
async function fetchGrantedScopes(
  clientId: string,
  client: GraphClientLike,
): Promise<{ granted: string[]; appDisplayName?: string }> {
  const safeId = clientId.replace(/'/g, "''");
  const sp = await client.api("/servicePrincipals").filter(`appId eq '${safeId}'`).select("id,displayName").get();
  const spRow = sp?.value?.[0];
  const spId: string | undefined = spRow?.id;
  if (!spId) return { granted: [] };

  const assignmentsRes = await client
    .api(`/servicePrincipals/${spId}/appRoleAssignments`)
    .select("appRoleId,resourceId")
    .get();
  const assignments = (assignmentsRes?.value ?? []) as { appRoleId: string; resourceId: string }[];

  const roleNamesByResource = new Map<string, Map<string, string>>();
  const granted: string[] = [];
  for (const a of assignments) {
    let roles = roleNamesByResource.get(a.resourceId);
    if (!roles) {
      const res = await client.api(`/servicePrincipals/${a.resourceId}`).select("appRoles").get();
      roles = new Map((res?.appRoles ?? []).map((x: { id: string; value: string }) => [x.id, x.value]));
      roleNamesByResource.set(a.resourceId, roles);
    }
    const name = roles.get(a.appRoleId);
    if (name) granted.push(name);
  }
  return { granted, appDisplayName: spRow?.displayName };
}

async function discoverTenant(client: GraphClientLike): Promise<TenantInfo | undefined> {
  try {
    const res = await client.api("/organization").select("id,displayName,verifiedDomains").get();
    const org = res?.value?.[0];
    if (!org) return undefined;
    const domains = (org.verifiedDomains ?? []).map((d) => d.name).filter(Boolean);
    const primaryDomain = org.verifiedDomains?.find((d) => d.isDefault)?.name ?? domains[0];
    return {
      id: org.id,
      displayName: org.displayName,
      primaryDomain,
      verifiedDomains: domains,
    };
  } catch {
    return undefined;
  }
}

/**
 * Validate stored credentials against the live tenant (PRD "Test Connection"):
 *   1. acquire an app-only token (proves tenant/client/secret or certificate),
 *   2. enumerate the app's *granted* Graph permissions and diff against what the
 *      catalog needs (incl. Mail.Send) + discover tenant metadata,
 *   3. confirm a shared mailbox is configured.
 * Persists status/config to both `settings` and `integrations` for refresh-safe UI.
 */
export async function testConnection(deps: TestConnectionDeps = {}): Promise<ConnectionTestResult> {
  const acquire = deps.acquireToken ?? acquireToken;
  const authMode = vaultService.authMode();
  const nowIso = new Date().toISOString();
  const existingConfig = (integrationsDao.findByProvider("microsoft365")?.config ?? {}) as Record<string, unknown>;

  const start = performance.now();
  try {
    await acquire({ forceRefresh: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const requestId = (err as { requestId?: string })?.requestId ?? requestIdFromError(err);
    settingsDao.update({ permissionStatus: "error", missingPermissions: [], lastPermissionCheck: nowIso });
    integrationsDao.upsert("microsoft365", {
      name: "Microsoft 365",
      status: "error",
      lastHealthCheck: nowIso,
      errorMessage: message,
      config: { ...existingConfig, authMode },
    });
    return {
      ok: false,
      authMode,
      steps: {
        auth: { ok: false, error: message, ...(requestId ? { requestId } : {}) },
        permissions: { ok: false, readable: false, granted: [], missing: [], note: "skipped — auth failed" },
        mailbox: { ok: false, note: "skipped — auth failed" },
      },
    };
  }
  const latencyMs = Math.round(performance.now() - start);

  const required = requiredScopes();
  const clientId = (deps.clientId ?? vaultService.get("clientId") ?? "").trim();
  if (!deps.client && !GUID_RE.test(clientId)) {
    const errMsg = "Client ID is missing or not a valid UUID/GUID";
    settingsDao.update({ permissionStatus: "error", missingPermissions: required, lastPermissionCheck: nowIso });
    integrationsDao.upsert("microsoft365", {
      name: "Microsoft 365",
      status: "error",
      lastHealthCheck: nowIso,
      errorMessage: errMsg,
    });
    return {
      ok: false,
      authMode,
      steps: {
        auth: { ok: true, latencyMs },
        permissions: { ok: false, readable: false, granted: [], missing: required, error: errMsg },
        mailbox: { ok: false, note: "skipped — invalid Client ID" },
      },
    };
  }

  const client = deps.client ?? (getSharedGraphClient() as unknown as GraphClientLike);
  let permissions: ConnectionTestResult["steps"]["permissions"];
  let appDisplayName: string | undefined;
  try {
    const scoped = await fetchGrantedScopes(clientId, client);
    appDisplayName = scoped.appDisplayName;
    const missing = computeMissing(required, scoped.granted);
    permissions = { ok: missing.length === 0, readable: true, granted: scoped.granted, missing };
  } catch (err) {
    // Can't enumerate — almost always because Application.Read.All itself is missing.
    const requestId = (err as { requestId?: string })?.requestId ?? requestIdFromError(err);
    const note = isForbidden(err)
      ? "Cannot read granted permissions — grant admin consent (incl. Application.Read.All) first."
      : `Permission probe failed: ${err instanceof Error ? err.message : String(err)}`;
    permissions = {
      ok: false,
      readable: false,
      granted: [],
      missing: required,
      error: note,
      ...(requestId ? { requestId } : {}),
    };
  }

  const tenant = await discoverTenant(client);

  const mailboxValue = (deps.mailbox ?? vaultService.get("mailbox"))?.trim();
  const mailbox = {
    ok: Boolean(mailboxValue),
    note: mailboxValue ? "shared mailbox configured" : "no shared mailbox set in the vault",
  };

  const ok = permissions.ok && mailbox.ok;
  // Connection is healthy at the auth/API level when auth succeeded AND either all
  // permissions are granted or Mail.Send/read scopes are verified; missing scopes
  // still mark `ok: false` if mailbox or permissions are missing so status reflects readiness.
  const integrationStatus = ok ? "connected" : permissions.readable && mailbox.ok ? "connected" : "error";
  const statusError = ok
    ? null
    : permissions.error ?? (permissions.missing.length ? `Missing ${permissions.missing.length} scope(s)` : mailbox.note);

  settingsDao.update({
    permissionStatus: ok ? "ok" : "missing",
    missingPermissions: permissions.missing,
    lastPermissionCheck: nowIso,
  });

  integrationsDao.upsert("microsoft365", {
    name: "Microsoft 365",
    status: integrationStatus,
    lastHealthCheck: nowIso,
    errorMessage: statusError,
    config: {
      ...existingConfig,
      authMode,
      ...(tenant?.id ? { tenantId: tenant.id } : {}),
      ...(tenant?.displayName ? { tenantDisplayName: tenant.displayName } : {}),
      ...(tenant?.primaryDomain ? { primaryDomain: tenant.primaryDomain } : {}),
      ...(tenant?.verifiedDomains ? { verifiedDomains: tenant.verifiedDomains } : {}),
      ...(appDisplayName ? { appDisplayName } : {}),
      permissionsReadable: permissions.readable,
      grantedScopes: permissions.granted,
      missingScopes: permissions.missing,
      certExpiresAt: vaultService.get("certExpiresAt") ?? existingConfig.certExpiresAt ?? null,
      certThumbprint: vaultService.get("certThumbprint") ?? existingConfig.certThumbprint ?? null,
    },
  });

  return {
    ok,
    authMode,
    ...(tenant ? { tenant } : {}),
    ...(appDisplayName ? { appDisplayName } : {}),
    steps: { auth: { ok: true, latencyMs }, permissions, mailbox },
  };
}
