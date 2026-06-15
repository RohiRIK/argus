import { DELEGATED_ADMIN_SCOPES, GRAPH_RESOURCE_APP_ID } from "@/lib/graph-consent";
import { mapScopesToRoleIds, buildRequiredResourceAccess } from "./permissions-grant";

/**
 * Delegated admin authorization flow (the "Authorize" button). The admin signs in
 * and consents the delegated write scopes; Argus exchanges the code for the admin's
 * token and uses it to DECLARE (append to the app registration) + GRANT its required
 * application permissions. The token is used transiently and never persisted.
 */

type FetchLike = typeof fetch;

interface ExchangeArgs {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}

/** Exchange an authorization code for a delegated admin access token. */
export async function exchangeCodeForToken(args: ExchangeArgs, deps: { fetch?: FetchLike } = {}): Promise<string> {
  const f = deps.fetch ?? fetch;
  const body = new URLSearchParams({
    client_id: args.clientId,
    client_secret: args.clientSecret,
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    scope: DELEGATED_ADMIN_SCOPES.join(" "),
  });
  const res = await f(`https://login.microsoftonline.com/${encodeURIComponent(args.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`Token exchange failed: ${json.error_description ?? json.error ?? `HTTP ${res.status}`}`);
  }
  return json.access_token;
}

export interface AppendGrantResult {
  declared: string[];
  granted: string[];
  stillMissing: string[];
}

interface AppRole {
  id: string;
  value: string;
}

/**
 * Using a delegated admin token: resolve the Graph service principal's app roles,
 * DECLARE the required scopes on the app registration (so the portal lists them),
 * then GRANT each via an app-role assignment (= consent). Idempotent on 409.
 */
export async function appendAndGrant(
  token: string,
  clientId: string,
  scopes: string[],
  deps: { fetch?: FetchLike } = {},
): Promise<AppendGrantResult> {
  const f = deps.fetch ?? fetch;
  const call = async (path: string, init?: RequestInit) => {
    const res = await f(`https://graph.microsoft.com/v1.0${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    const json = res.status === 204 ? {} : await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json: json as Record<string, unknown> };
  };
  const must = async (path: string, init?: RequestInit) => {
    const r = await call(path, init);
    if (!r.ok) throw new Error(((r.json as { error?: { message?: string } }).error?.message) ?? `Graph ${path} → ${r.status}`);
    return r.json;
  };

  const graphSp = ((await must(`/servicePrincipals?$filter=appId eq '${GRAPH_RESOURCE_APP_ID}'&$select=id,appId,appRoles`)).value as
    | { id: string; appId: string; appRoles?: AppRole[] }[]
    | undefined)?.[0];
  const argusSp = ((await must(`/servicePrincipals?$filter=appId eq '${clientId}'&$select=id`)).value as { id: string }[] | undefined)?.[0];
  if (!graphSp || !argusSp) throw new Error("Could not resolve the Graph or app service principal.");

  const roles = mapScopesToRoleIds(graphSp.appRoles ?? [], scopes);

  // Declare on the app registration so the portal's "Configured permissions" lists them.
  let declared: string[] = [];
  const appReg = ((await must(`/applications?$filter=appId eq '${clientId}'&$select=id,requiredResourceAccess`)).value as
    | { id: string; requiredResourceAccess?: { resourceAppId: string; resourceAccess: { id: string; type: string }[] }[] }[]
    | undefined)?.[0];
  if (appReg) {
    const rra = buildRequiredResourceAccess(appReg.requiredResourceAccess ?? [], GRAPH_RESOURCE_APP_ID, roles.map((r) => r.id));
    await must(`/applications/${appReg.id}`, { method: "PATCH", body: JSON.stringify({ requiredResourceAccess: rra }) });
    declared = roles.map((r) => r.value);
  }

  // Grant each role (= consent). 409 = already assigned.
  const granted: string[] = [];
  for (const role of roles) {
    const r = await call(`/servicePrincipals/${argusSp.id}/appRoleAssignments`, {
      method: "POST",
      body: JSON.stringify({ principalId: argusSp.id, resourceId: graphSp.id, appRoleId: role.id }),
    });
    if (r.ok || r.status === 409) granted.push(role.value);
  }

  const stillMissing = scopes.filter((s) => !granted.includes(s));
  return { declared, granted, stillMissing };
}
