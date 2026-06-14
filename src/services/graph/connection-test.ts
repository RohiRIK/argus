import { acquireToken } from "./auth";
import { getSharedGraphClient } from "./client";
import { vaultService } from "@/services/vault/vault";
import { settingsDao } from "@/db/dao/settings";
import { listReports } from "@/services/reports/registry";

export interface ConnectionTestResult {
  ok: boolean;
  steps: {
    auth: { ok: boolean; latencyMs?: number; error?: string };
    permissions: { ok: boolean; granted: string[]; missing: string[]; note?: string; error?: string };
    mailbox: { ok: boolean; note?: string; error?: string };
  };
}

/**
 * Every application permission Argus actually needs: the union of every report's
 * `requiredPermissions` plus `Mail.Send` (required to deliver). `(depends on …)`
 * placeholders from the manual-query report are skipped.
 */
export function requiredScopes(): string[] {
  const set = new Set<string>(["Mail.Send"]);
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

/**
 * Resolve the application permission **names** actually granted to our app's
 * service principal, via `appRoleAssignments` → resolving each `appRoleId` to a
 * name on the resource SP (Microsoft Graph). Needs `Application.Read.All`.
 */
async function fetchGrantedScopes(clientId: string): Promise<string[]> {
  const client = getSharedGraphClient();
  const sp = await client.api("/servicePrincipals").filter(`appId eq '${clientId}'`).select("id").get();
  const spId: string | undefined = sp?.value?.[0]?.id;
  if (!spId) return [];

  const assignmentsRes = await client
    .api(`/servicePrincipals/${spId}/appRoleAssignments`)
    .select("appRoleId,resourceId")
    .get();
  const assignments: { appRoleId: string; resourceId: string }[] = assignmentsRes?.value ?? [];

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
  return granted;
}

/**
 * Validate stored credentials against the live tenant (PRD "Test Connection"):
 *   1. acquire an app-only token (proves tenant/client/secret),
 *   2. enumerate the app's *granted* Graph permissions and diff against what the
 *      catalog needs (incl. Mail.Send) — surfaces the exact missing scopes,
 *   3. confirm a shared mailbox is configured.
 * Persists `permissionStatus` + `missingPermissions` for the Settings UI.
 */
export async function testConnection(): Promise<ConnectionTestResult> {
  const start = performance.now();
  try {
    await acquireToken({ forceRefresh: true });
  } catch (err) {
    settingsDao.update({ permissionStatus: "error", missingPermissions: [], lastPermissionCheck: new Date().toISOString() });
    return {
      ok: false,
      steps: {
        auth: { ok: false, error: err instanceof Error ? err.message : String(err) },
        permissions: { ok: false, granted: [], missing: [], note: "skipped — auth failed" },
        mailbox: { ok: false, note: "skipped — auth failed" },
      },
    };
  }
  const latencyMs = Math.round(performance.now() - start);

  const required = requiredScopes();
  const clientId = vaultService.get("clientId") ?? "";
  let permissions: ConnectionTestResult["steps"]["permissions"];
  try {
    const granted = await fetchGrantedScopes(clientId);
    const missing = computeMissing(required, granted);
    permissions = { ok: missing.length === 0, granted, missing };
  } catch (err) {
    // Can't enumerate — almost always because Application.Read.All itself is missing.
    const note = isForbidden(err)
      ? "Cannot read granted permissions — grant Application.Read.All (admin consent) first."
      : `Permission probe failed: ${err instanceof Error ? err.message : String(err)}`;
    permissions = { ok: false, granted: [], missing: required, error: note };
  }

  const mailboxValue = vaultService.get("mailbox");
  const mailbox = {
    ok: Boolean(mailboxValue),
    note: mailboxValue ? "shared mailbox configured" : "no shared mailbox set in the vault",
  };

  const ok = permissions.ok && mailbox.ok;
  settingsDao.update({
    permissionStatus: ok ? "ok" : "missing",
    missingPermissions: permissions.missing,
    lastPermissionCheck: new Date().toISOString(),
  });

  return { ok, steps: { auth: { ok: true, latencyMs }, permissions, mailbox } };
}
