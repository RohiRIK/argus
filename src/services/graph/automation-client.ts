import { Client, type AuthenticationProvider } from "@microsoft/microsoft-graph-client";
import { withRetry } from "@/lib/retry";
import { GraphApiError, GraphAuthError, ValidationError } from "@/lib/errors";
import { GUID_RE } from "@/lib/validation";
import { isAlreadyAssignedError } from "@/lib/graph-consent";
import { vaultService } from "@/services/vault/vault";
import { integrationsDao } from "@/db/dao/integrations";
import { auditDao } from "@/db/dao/audit";
import { automationPoliciesDao } from "@/db/dao/automations";
import { signClientAssertion } from "./cert";
import {
  graphErrorMessage,
  requestIdFromError,
  retryAfterMsFromError,
  type GraphPage,
} from "./client";
import { computeMissing, type ConnectionTestResult, type TenantInfo } from "./connection-test";
import {
  GRAPH_APP_ID,
  mapScopesToRoleIds,
  buildRequiredResourceAccess,
  type GrantResult,
} from "./permissions-grant";
import type { AutomationGraphTransport } from "@/services/automations/types";

export const AUTOMATION_PROVIDER = "microsoft365-automation" as const;

const SCOPE = "https://graph.microsoft.com/.default";
const EXPIRY_SKEW_MS = 60_000;
const MAX_PAGES = 50;

export type AutomationCredentials =
  | {
      tenantId: string;
      clientId: string;
      clientSecret: string;
      privateKeyPem?: never;
      x5t?: never;
    }
  | {
      tenantId: string;
      clientId: string;
      privateKeyPem: string;
      x5t: string;
      clientSecret?: string;
    };

interface CachedToken {
  token: string;
  expiresAt: number;
}

// Completely isolated token cache + SDK client so Read-Only Reporting and Read-Write Automation never cross-contaminate.
let autoTokenCache: CachedToken | null = null;
let autoInFlight: Promise<string> | null = null;
let autoSharedClient: Client | null = null;

export function automationCredsFromVault(): AutomationCredentials {
  const tenantId = (vaultService.get("auto_tenantId") ?? vaultService.get("tenantId"))?.trim();
  const clientId = vaultService.get("auto_clientId")?.trim();
  const privateKeyPem = vaultService.get("auto_clientPrivateKey");
  const x5t = vaultService.get("auto_certThumbprintX5t");
  const clientSecret = vaultService.get("auto_clientSecret");

  if (!tenantId || !clientId) {
    throw new GraphAuthError(
      "Microsoft 365 Automation credentials are not configured — set up the Automation app in Settings → Integrations.",
    );
  }
  if (privateKeyPem && x5t) {
    return { tenantId, clientId, privateKeyPem, x5t, clientSecret };
  }
  if (!clientSecret) {
    throw new GraphAuthError(
      "Microsoft 365 Automation certificate or secret is missing in the vault.",
    );
  }
  return { tenantId, clientId, clientSecret };
}

export interface AcquireAutomationOptions {
  creds?: AutomationCredentials;
  fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  forceRefresh?: boolean;
  sleep?: (ms: number) => Promise<void>;
}

export async function acquireAutomationToken(options: AcquireAutomationOptions = {}): Promise<string> {
  const now = options.now ?? Date.now;
  if (!options.forceRefresh) {
    if (autoTokenCache && autoTokenCache.expiresAt > now() + EXPIRY_SKEW_MS) {
      return autoTokenCache.token;
    }
    if (autoInFlight) return autoInFlight;
  }

  const p = (async () => {
    const creds = options.creds ?? automationCredsFromVault();
    const fetchImpl = options.fetchImpl ?? fetch;
    const url = `https://login.microsoftonline.com/${encodeURIComponent(creds.tenantId)}/oauth2/v2.0/token`;

    const result = await withRetry(
      async () => {
        const params: Record<string, string> = {
          client_id: creds.clientId,
          scope: SCOPE,
          grant_type: "client_credentials",
        };
        if ("privateKeyPem" in creds && creds.privateKeyPem && creds.x5t) {
          params.client_assertion_type = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
          params.client_assertion = signClientAssertion({
            tenantId: creds.tenantId,
            clientId: creds.clientId,
            privateKeyPem: creds.privateKeyPem,
            x5t: creds.x5t,
            nowSec: Math.floor(now() / 1000),
          });
        } else if (creds.clientSecret) {
          params.client_secret = creds.clientSecret;
        }
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(params),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error_description?: string;
            correlation_id?: string;
          } | null;
          const firstLine = body?.error_description?.split(/\r?\n/)[0]?.trim();
          throw new GraphApiError(
            firstLine
              ? `Automation Entra token request failed (${res.status}): ${firstLine}`
              : `Automation token endpoint returned ${res.status}`,
            { graphStatus: res.status, requestId: body?.correlation_id },
          );
        }
        return (await res.json()) as { access_token: string; expires_in: number };
      },
      { sleep: options.sleep },
    );

    autoTokenCache = { token: result.access_token, expiresAt: now() + result.expires_in * 1000 };
    return autoTokenCache.token;
  })().finally(() => {
    if (autoInFlight === p) autoInFlight = null;
  });

  if (!options.forceRefresh) autoInFlight = p;
  return p;
}

export function clearAutomationTokenCache(): void {
  autoTokenCache = null;
  autoInFlight = null;
}

class AutomationVaultAuthProvider implements AuthenticationProvider {
  async getAccessToken(): Promise<string> {
    return acquireAutomationToken();
  }
}

export function getAutomationGraphClient(): Client {
  if (!autoSharedClient) {
    autoSharedClient = Client.initWithMiddleware({ authProvider: new AutomationVaultAuthProvider() });
  }
  return autoSharedClient;
}

export function resetAutomationGraphClient(): void {
  autoSharedClient = null;
}

export function __setAutomationGraphClientForTests(client: unknown): void {
  autoSharedClient = client as Client;
}

function wrapAutomationError(err: unknown, path: string): GraphApiError {
  const status = (err as { statusCode?: number }).statusCode;
  const baseMsg = graphErrorMessage(err, path).replace(
    "Settings → Integrations",
    "Settings → Integrations → Microsoft 365 Automation",
  );
  const gErr = new GraphApiError(baseMsg, {
    graphStatus: status,
    requestId: requestIdFromError(err),
    cause: err,
  });
  const ra = retryAfterMsFromError(err);
  if (ra !== undefined) (gErr as { retryAfterMs?: number }).retryAfterMs = ra;
  return gErr;
}

function buildApiCall(client: Client, path: string) {
  const isBeta = path.startsWith("/beta/");
  return isBeta ? client.api(path.slice("/beta".length)).version("beta") : client.api(path);
}

export const liveAutomationGraphTransport: AutomationGraphTransport = {
  async get<T>(path: string): Promise<GraphPage<T>> {
    const client = getAutomationGraphClient();
    const started = performance.now();
    const value: T[] = [];
    let nextUrl: string | undefined = path;
    let pages = 0;
    let truncated = false;

    while (nextUrl) {
      if (pages >= MAX_PAGES) {
        truncated = true;
        break;
      }
      const url: string = nextUrl;
      const res = await withRetry(async () => {
        try {
          return (await buildApiCall(client, url).get()) as {
            value?: T[];
            "@odata.nextLink"?: string;
          };
        } catch (err) {
          throw wrapAutomationError(err, url);
        }
      });
      if (res.value?.length) value.push(...res.value);
      nextUrl = res["@odata.nextLink"];
      pages++;
    }

    return { value, latencyMs: Math.round(performance.now() - started), truncated };
  },

  async getOne<T>(path: string): Promise<{ data: T; latencyMs: number }> {
    const client = getAutomationGraphClient();
    const started = performance.now();
    const data = await withRetry(async () => {
      try {
        return (await buildApiCall(client, path).get()) as T;
      } catch (err) {
        throw wrapAutomationError(err, path);
      }
    });
    return { data, latencyMs: Math.round(performance.now() - started) };
  },

  async post<T>(path: string, body?: unknown): Promise<{ data: T; latencyMs: number }> {
    const client = getAutomationGraphClient();
    const started = performance.now();
    const data = await withRetry(async () => {
      try {
        return (await buildApiCall(client, path).post(body ?? {})) as T;
      } catch (err) {
        throw wrapAutomationError(err, path);
      }
    });
    return { data, latencyMs: Math.round(performance.now() - started) };
  },

  async patch<T>(path: string, body: unknown): Promise<{ data: T; latencyMs: number }> {
    const client = getAutomationGraphClient();
    const started = performance.now();
    const data = await withRetry(async () => {
      try {
        return (await buildApiCall(client, path).patch(body)) as T;
      } catch (err) {
        throw wrapAutomationError(err, path);
      }
    });
    return { data, latencyMs: Math.round(performance.now() - started) };
  },

  async delete(path: string): Promise<{ latencyMs: number }> {
    const client = getAutomationGraphClient();
    const started = performance.now();
    await withRetry(async () => {
      try {
        await buildApiCall(client, path).delete();
      } catch (err) {
        throw wrapAutomationError(err, path);
      }
    });
    return { latencyMs: Math.round(performance.now() - started) };
  },
};

/**
 * Union of Microsoft Graph Application scopes required by the Automation Catalog
 * (or only active automation policies when `activeOnly = true`), plus baseline
 * `Application.Read.All` + `Organization.Read.All` for self-inspection.
 */
export async function requiredAutomationScopes(opts: { activeOnly?: boolean } = {}): Promise<string[]> {
  const { listAutomations, getAutomation } = await import("@/services/automations/registry");
  const set = new Set<string>(["Application.Read.All", "Organization.Read.All"]);
  if (opts.activeOnly) {
    for (const policy of automationPoliciesDao.active()) {
      const def = getAutomation(policy.automationType);
      if (def) {
        for (const p of def.requiredPermissions) set.add(p);
      }
    }
  } else {
    for (const def of listAutomations()) {
      for (const p of def.requiredPermissions) set.add(p);
    }
  }
  return [...set].sort();
}

interface GraphClientProbeLike {
  api(path: string): {
    filter(f: string): {
      select(s: string): {
        get(): Promise<{
          value?: {
            id: string;
            displayName?: string;
            requiredResourceAccess?: { resourceAppId: string; resourceAccess: { id: string; type: string }[] }[];
            appRoles?: { id: string; value: string }[];
          }[];
        }>;
      };
    };
    select(s: string): {
      get(): Promise<{
        value?: {
          id?: string;
          displayName?: string;
          verifiedDomains?: { name: string; isDefault?: boolean }[];
          appRoleId?: string;
          resourceId?: string;
        }[];
        appRoles?: { id: string; value: string }[];
      }>;
    };
    post(body: unknown): Promise<unknown>;
    patch(body: unknown): Promise<unknown>;
  };
}

export interface TestAutomationConnectionDeps {
  acquireToken?: (opts?: { forceRefresh?: boolean }) => Promise<unknown>;
  client?: GraphClientProbeLike;
  clientId?: string;
}

async function fetchAutomationGrantedScopes(
  clientId: string,
  client: GraphClientProbeLike,
): Promise<{ granted: string[]; appDisplayName?: string }> {
  const safeId = clientId.replace(/'/g, "''");
  const sp = await client.api("/servicePrincipals").filter(`appId eq '${safeId}'`).select("id,displayName").get();
  const spRow = sp?.value?.[0];
  if (!spRow?.id) return { granted: [] };

  const assignmentsRes = await client
    .api(`/servicePrincipals/${spRow.id}/appRoleAssignments`)
    .select("appRoleId,resourceId")
    .get();
  const assignments = (assignmentsRes?.value ?? []) as { appRoleId: string; resourceId: string }[];

  const roleNamesByResource = new Map<string, Map<string, string>>();
  const granted: string[] = [];
  for (const a of assignments) {
    let roles = roleNamesByResource.get(a.resourceId);
    if (!roles) {
      const res = await client.api(`/servicePrincipals/${a.resourceId}`).select("appRoles").get();
      roles = new Map((res?.appRoles ?? []).map((x) => [x.id, x.value]));
      roleNamesByResource.set(a.resourceId, roles);
    }
    const name = roles.get(a.appRoleId);
    if (name) granted.push(name);
  }
  return { granted, appDisplayName: spRow.displayName };
}

async function discoverAutomationTenant(client: GraphClientProbeLike): Promise<TenantInfo | undefined> {
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

export async function testAutomationConnection(
  deps: TestAutomationConnectionDeps = {},
): Promise<ConnectionTestResult> {
  const acquire = deps.acquireToken ?? acquireAutomationToken;
  const authMode = vaultService.automationAuthMode();
  const nowIso = new Date().toISOString();
  const existingConfig = (integrationsDao.findByProvider(AUTOMATION_PROVIDER)?.config ?? {}) as Record<string, unknown>;

  const start = performance.now();
  try {
    await acquire({ forceRefresh: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const requestId = (err as { requestId?: string })?.requestId ?? requestIdFromError(err);
    integrationsDao.upsert(AUTOMATION_PROVIDER, {
      name: "Microsoft 365 Automation",
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
        mailbox: { ok: true, note: "uses reporting sender mailbox for notifications" },
      },
    };
  }
  const latencyMs = Math.round(performance.now() - start);

  const required = await requiredAutomationScopes();
  const activeRequired = await requiredAutomationScopes({ activeOnly: true });
  const clientId = (deps.clientId ?? vaultService.get("auto_clientId") ?? "").trim();
  if (!deps.client && !GUID_RE.test(clientId)) {
    const errMsg = "Automation Client ID is missing or not a valid UUID/GUID";
    integrationsDao.upsert(AUTOMATION_PROVIDER, {
      name: "Microsoft 365 Automation",
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
        mailbox: { ok: true, note: "isolated write service principal" },
      },
    };
  }

  const client = deps.client ?? (getAutomationGraphClient() as unknown as GraphClientProbeLike);
  let permissions: ConnectionTestResult["steps"]["permissions"];
  let appDisplayName: string | undefined;
  let activeMissing: string[] = [];

  try {
    const scoped = await fetchAutomationGrantedScopes(clientId, client);
    appDisplayName = scoped.appDisplayName;
    const missing = computeMissing(required, scoped.granted);
    activeMissing = computeMissing(activeRequired, scoped.granted);
    permissions = {
      ok: missing.length === 0,
      readable: true,
      granted: scoped.granted,
      missing,
      ...(missing.length > 0 && activeMissing.length === 0
        ? { note: "All active policies satisfied (optional catalog scopes ungranted)" }
        : {}),
    };
  } catch (err) {
    const requestId = (err as { requestId?: string })?.requestId ?? requestIdFromError(err);
    const is403 = (err as { statusCode?: number })?.statusCode === 403;
    permissions = {
      ok: false,
      readable: false,
      granted: [],
      missing: required,
      error: is403
        ? "Cannot read granted permissions — grant admin consent (incl. Application.Read.All) first."
        : `Permission probe failed: ${err instanceof Error ? err.message : String(err)}`,
      ...(requestId ? { requestId } : {}),
    };
  }

  const tenant = await discoverAutomationTenant(client);
  const mailboxInfo = {
    ok: true,
    note: vaultService.get("mailbox")
      ? `notifications via ${vaultService.get("mailbox")}`
      : "isolated Graph remediation app (no Mail.Send granted)",
  };

  // Connected as soon as Entra auth works and active policies aren't missing scopes (or scopes are readable).
  const ready = permissions.readable && activeMissing.length === 0;
  const integrationStatus = ready ? "connected" : "error";
  const statusError = permissions.ok
    ? null
    : permissions.error ??
      (activeMissing.length > 0
        ? `Missing ${activeMissing.length} scope(s) for active automations`
        : null);

  integrationsDao.upsert(AUTOMATION_PROVIDER, {
    name: "Microsoft 365 Automation",
    status: integrationStatus,
    lastHealthCheck: nowIso,
    errorMessage: statusError,
    config: {
      ...existingConfig,
      authMode,
      ...(tenant?.id ? { tenantId: tenant.id } : {}),
      ...(tenant?.displayName ? { tenantDisplayName: tenant.displayName } : {}),
      ...(tenant?.primaryDomain ? { primaryDomain: tenant.primaryDomain } : {}),
      ...(appDisplayName ? { appDisplayName } : {}),
      permissionsReadable: permissions.readable,
      grantedScopes: permissions.granted,
      missingScopes: permissions.missing,
      activeMissingScopes: activeMissing,
      certExpiresAt: vaultService.get("auto_certExpiresAt") ?? existingConfig.certExpiresAt ?? null,
      certThumbprint: vaultService.get("auto_certThumbprint") ?? existingConfig.certThumbprint ?? null,
    },
  });

  return {
    ok: ready,
    authMode,
    ...(tenant ? { tenant } : {}),
    ...(appDisplayName ? { appDisplayName } : {}),
    steps: { auth: { ok: true, latencyMs }, permissions, mailbox: mailboxInfo },
  };
}

export async function grantAutomationMissingPermissions(
  deps: TestAutomationConnectionDeps = {},
): Promise<GrantResult> {
  try {
    const client = deps.client ?? (getAutomationGraphClient() as unknown as GraphClientProbeLike);
    const clientId = (deps.clientId ?? vaultService.get("auto_clientId") ?? "").trim();
    if (!clientId) throw new ValidationError("No Automation Client ID configured in the vault.");

    const before = await testAutomationConnection(deps);
    const missing = before.steps.permissions.missing;
    if (missing.length === 0) return { granted: [], stillMissing: [] };

    const graphSpRes = await client
      .api("/servicePrincipals")
      .filter(`appId eq '${GRAPH_APP_ID}'`)
      .select("id,appRoles")
      .get();
    const autoSpRes = await client
      .api("/servicePrincipals")
      .filter(`appId eq '${clientId.replace(/'/g, "''")}'`)
      .select("id,appRoles")
      .get();
    const graphSp = graphSpRes?.value?.[0];
    const autoSp = autoSpRes?.value?.[0];
    if (!graphSp || !autoSp) {
      throw new GraphApiError("Could not resolve service principals — grant Application.Read.All first.");
    }

    const roles = mapScopesToRoleIds(graphSp.appRoles ?? [], missing);
    const granted: string[] = [];
    for (const role of roles) {
      try {
        await client.api(`/servicePrincipals/${autoSp.id}/appRoleAssignments`).post({
          principalId: autoSp.id,
          resourceId: graphSp.id,
          appRoleId: role.id,
        });
        granted.push(role.value);
      } catch (err) {
        const e = err as { statusCode?: number; message?: string; body?: string };
        if (isAlreadyAssignedError(e.statusCode, e.message ?? e.body)) {
          granted.push(role.value);
        } else {
          throw new GraphApiError(
            `Failed to grant ${role.value} on Automation app. Re-deploy via Quick Setup or grant admin consent in Entra.${e.message ? ` (${e.message})` : ""}`,
            { graphStatus: e.statusCode, requestId: requestIdFromError(err), cause: err },
          );
        }
      }
    }

    let manifestError: string | undefined;
    try {
      const appRes = await client
        .api("/applications")
        .filter(`appId eq '${clientId.replace(/'/g, "''")}'`)
        .select("id,requiredResourceAccess")
        .get();
      const app = appRes?.value?.[0];
      if (app) {
        const rra = buildRequiredResourceAccess(
          app.requiredResourceAccess ?? [],
          GRAPH_APP_ID,
          roles.map((r) => r.id),
        );
        await client.api(`/applications/${app.id}`).patch({ requiredResourceAccess: rra });
      }
    } catch (err) {
      manifestError = `Could not update Automation app manifest: ${err instanceof Error ? err.message : String(err)}`;
    }

    const after = await testAutomationConnection(deps);
    const result: GrantResult = {
      granted,
      stillMissing: after.steps.permissions.missing,
      ...(manifestError ? { manifestError } : {}),
    };
    auditDao.record({
      action: "automation_permission_grant",
      provider: AUTOMATION_PROVIDER,
      outcome: result.stillMissing.length === 0 ? "success" : "partial",
      detail: { granted: result.granted, stillMissing: result.stillMissing },
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    auditDao.record({
      action: "automation_permission_grant",
      provider: AUTOMATION_PROVIDER,
      outcome: "error",
      detail: { error: message },
    });
    throw err;
  }
}
