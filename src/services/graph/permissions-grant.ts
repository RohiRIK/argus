import { getSharedGraphClient } from "./client";
import { vaultService } from "@/services/vault/vault";
import { testConnection } from "./connection-test";

/** Microsoft Graph's well-known application id. */
export const GRAPH_APP_ID = "00000003-0000-0000-c000-000000000000";

export interface GrantResult {
  granted: string[];
  stillMissing: string[];
}

interface AppRole {
  id: string;
  value: string;
}
interface RequiredResourceAccess {
  resourceAppId: string;
  resourceAccess: { id: string; type: string }[];
}

/** Admin-consent URL that consents the app's declared permissions (D1 bootstrap). Pure. */
export function adminConsentUrl(tenantId: string, clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state: "argus-consent" });
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/adminconsent?${params.toString()}`;
}

/** Resolve permission names to the Graph resource SP's appRole ids. Pure. */
export function mapScopesToRoleIds(appRoles: AppRole[], names: string[]): AppRole[] {
  const byName = new Map(appRoles.map((r) => [r.value, r.id]));
  return names.flatMap((n) => {
    const id = byName.get(n);
    return id ? [{ id, value: n }] : [];
  });
}

/** Merge new Graph appRole ids into an app's requiredResourceAccess, de-duplicated. Pure. */
export function buildRequiredResourceAccess(
  existing: RequiredResourceAccess[],
  graphAppId: string,
  roleIds: string[],
): RequiredResourceAccess[] {
  const out = existing.map((e) => ({ resourceAppId: e.resourceAppId, resourceAccess: [...e.resourceAccess] }));
  let graph = out.find((e) => e.resourceAppId === graphAppId);
  if (!graph) {
    graph = { resourceAppId: graphAppId, resourceAccess: [] };
    out.push(graph);
  }
  const have = new Set(graph.resourceAccess.map((r) => r.id));
  for (const id of roleIds) if (!have.has(id)) graph.resourceAccess.push({ id, type: "Role" });
  return out;
}

interface GraphClientLike {
  api(path: string): {
    filter(f: string): { select(s: string): { get(): Promise<unknown> } };
    select(s: string): { get(): Promise<unknown> };
    post(body: unknown): Promise<unknown>;
    patch(body: unknown): Promise<unknown>;
  };
}

async function spByAppId(client: GraphClientLike, appId: string): Promise<{ id: string; appRoles?: AppRole[] } | undefined> {
  const res = (await client.api("/servicePrincipals").filter(`appId eq '${appId}'`).select("id,appRoles").get()) as {
    value?: { id: string; appRoles?: AppRole[] }[];
  };
  return res?.value?.[0];
}

/**
 * D2: programmatically grant the app every still-missing Graph permission by
 * creating appRoleAssignments on its service principal (= admin consent), and
 * declaring the roles on the application manifest. Needs the bootstrap scopes
 * (`AppRoleAssignment.ReadWrite.All` + `Application.ReadWrite.All`) — otherwise
 * the Graph calls 403 and we surface a clear "run the bootstrap first" error.
 */
export async function grantMissingPermissions(): Promise<GrantResult> {
  const client = getSharedGraphClient() as unknown as GraphClientLike;
  const clientId = vaultService.get("clientId") ?? "";
  if (!clientId) throw new Error("No client ID configured in the vault.");

  const before = await testConnection();
  const missing = before.steps.permissions.missing;
  if (missing.length === 0) return { granted: [], stillMissing: [] };

  const graphSp = await spByAppId(client, GRAPH_APP_ID);
  const argusSp = await spByAppId(client, clientId);
  if (!graphSp || !argusSp) {
    throw new Error("Could not resolve the service principals — grant Application.Read.All first.");
  }

  const roles = mapScopesToRoleIds(graphSp.appRoles ?? [], missing);
  const granted: string[] = [];
  for (const role of roles) {
    try {
      await client.api(`/servicePrincipals/${argusSp.id}/appRoleAssignments`).post({
        principalId: argusSp.id,
        resourceId: graphSp.id,
        appRoleId: role.id,
      });
      granted.push(role.value);
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 409) {
        granted.push(role.value); // already assigned
      } else {
        throw new Error(
          `Failed to grant ${role.value}. Argus needs AppRoleAssignment.ReadWrite.All — run "Authorize self-management" first.`,
        );
      }
    }
  }

  // Declare the roles on the app manifest too (cosmetic; assignment above is the real grant).
  try {
    const appRes = (await client.api("/applications").filter(`appId eq '${clientId}'`).select("id,requiredResourceAccess").get()) as {
      value?: { id: string; requiredResourceAccess?: RequiredResourceAccess[] }[];
    };
    const app = appRes?.value?.[0];
    if (app) {
      const rra = buildRequiredResourceAccess(app.requiredResourceAccess ?? [], GRAPH_APP_ID, roles.map((r) => r.id));
      await client.api(`/applications/${app.id}`).patch({ requiredResourceAccess: rra });
    }
  } catch {
    /* manifest declaration is best-effort */
  }

  const after = await testConnection();
  return { granted, stillMissing: after.steps.permissions.missing };
}
