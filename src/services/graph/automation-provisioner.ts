import { getPublicOrigin } from "@/lib/request-origin";
import { hasMasterKey } from "@/config/env";
import { vaultService } from "@/services/vault/vault";
import { generateSelfSignedCert } from "./cert";
import { mapScopesToRoleIds, buildRequiredResourceAccess, GRAPH_APP_ID } from "./permissions-grant";
import {
  AUTOMATION_PROVIDER,
  clearAutomationTokenCache,
  resetAutomationGraphClient,
  requiredAutomationScopes,
  testAutomationConnection,
} from "./automation-client";
import { auditDao } from "@/db/dao/audit";
import { AUTHORIZE_CALLBACK_PATH, isAlreadyAssignedError } from "@/lib/graph-consent";
import { NotFoundError, VaultError, ValidationError } from "@/lib/errors";

const AZURE_PUBLIC_CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e";
const DEPLOY_SCOPES = [
  "Application.ReadWrite.All",
  "AppRoleAssignment.ReadWrite.All",
  "Organization.Read.All",
  "Directory.Read.All",
  "offline_access",
].join(" ");

const SESSION_TTL_MS = 15 * 60_000;

export type AutomationDeployStepId = "login" | "tenant" | "cert" | "app" | "sp" | "grants" | "vault";
export type AutomationDeployStepStatus = "pending" | "running" | "done" | "error";

export interface AutomationDeployStep {
  id: AutomationDeployStepId;
  label: string;
  status: AutomationDeployStepStatus;
  detail?: string;
  correlationId?: string;
}

export interface AutomationDeployResult {
  tenantId: string;
  tenantDisplayName: string;
  primaryDomain?: string;
  clientId: string;
  appDisplayName: string;
  certThumbprint: string;
  certExpiresAt: string;
  grantedCount: number;
  missingScopes: string[];
}

export interface AutomationDeploySnapshot {
  id: string;
  mode: "create" | "upgrade";
  phase: "awaiting_login" | "running" | "succeeded" | "failed";
  steps: AutomationDeployStep[];
  deviceCode?: {
    userCode: string;
    verificationUri: string;
    expiresAt: string;
    intervalSec: number;
  };
  result?: AutomationDeployResult;
  error?: string;
  correlationId?: string;
}

interface InternalAutomationDeploySession extends AutomationDeploySnapshot {
  appName: string;
  scopeMode: "all" | "active";
  redirectUri: string;
  deviceCodeSecret: string;
  createdAtMs: number;
  expiresAtMs: number;
  pipelineStarted?: boolean;
}

export interface AutomationProvisionerDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  testConnection?: typeof testAutomationConnection;
  waitForPipeline?: boolean;
}

const g = globalThis as unknown as {
  __argusAutomationDeploySessions?: Map<string, InternalAutomationDeploySession>;
};

function store(): Map<string, InternalAutomationDeploySession> {
  if (!g.__argusAutomationDeploySessions) g.__argusAutomationDeploySessions = new Map();
  const now = Date.now();
  for (const [k, s] of g.__argusAutomationDeploySessions.entries()) {
    if (now - s.createdAtMs > SESSION_TTL_MS) g.__argusAutomationDeploySessions.delete(k);
  }
  return g.__argusAutomationDeploySessions;
}

function initialSteps(mode: "create" | "upgrade"): AutomationDeployStep[] {
  return [
    {
      id: "login",
      label: "Sign in to Microsoft 365",
      status: "running",
      detail: "Waiting for device code authentication",
    },
    { id: "tenant", label: "Verify tenant boundary", status: "pending" },
    { id: "cert", label: "Generate dedicated X.509 certificate", status: "pending" },
    {
      id: "app",
      label:
        mode === "upgrade"
          ? "Attach certificate to Automation App Registration"
          : "Create isolated Automation App Registration",
      status: "pending",
    },
    { id: "sp", label: "Provision Enterprise Service Principal", status: "pending" },
    { id: "grants", label: "Grant scoped Graph remediation permissions", status: "pending" },
    { id: "vault", label: "Encrypt keys in isolated vault & verify auth", status: "pending" },
  ];
}

function setStep(
  s: InternalAutomationDeploySession,
  id: AutomationDeployStepId,
  patch: Partial<AutomationDeployStep>,
) {
  const step = s.steps.find((x) => x.id === id);
  if (step) Object.assign(step, patch);
}

function toSnapshot(s: InternalAutomationDeploySession): AutomationDeploySnapshot {
  return {
    id: s.id,
    mode: s.mode,
    phase: s.phase,
    steps: s.steps.map((x) => ({ ...x })),
    ...(s.deviceCode ? { deviceCode: { ...s.deviceCode } } : {}),
    ...(s.result ? { result: { ...s.result } } : {}),
    ...(s.error ? { error: s.error } : {}),
    ...(s.correlationId ? { correlationId: s.correlationId } : {}),
  };
}

export async function startAutomationDeploySession(
  opts: {
    mode?: "create" | "upgrade";
    appName?: string;
    scopeMode?: "all" | "active";
    origin?: string;
    req?: Request;
  },
  deps: AutomationProvisionerDeps = {},
): Promise<AutomationDeploySnapshot> {
  if (!hasMasterKey()) {
    throw new VaultError("ARGUS_MASTER_KEY must be set before deploying Automation to Microsoft 365");
  }
  const mode = opts.mode ?? "create";
  if (mode === "upgrade" && !vaultService.get("auto_clientId")) {
    throw new ValidationError("No existing Automation Client ID in vault to upgrade");
  }

  const origin = opts.origin ?? (opts.req ? getPublicOrigin(opts.req) : "http://localhost:8100");
  const redirectUri = `${origin}${AUTHORIZE_CALLBACK_PATH}`;
  const appName = opts.appName?.trim() || "Argus M365 Automation";
  const f = deps.fetch ?? fetch;

  const res = await f("https://login.microsoftonline.com/organizations/oauth2/v2.0/devicecode", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: AZURE_PUBLIC_CLIENT_ID,
      scope: DEPLOY_SCOPES,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    expires_in?: number;
    interval?: number;
    error_description?: string;
  };
  if (!res.ok || !body.device_code || !body.user_code || !body.verification_uri) {
    throw new ValidationError(
      body.error_description ?? `Failed to start Microsoft device login (HTTP ${res.status})`,
    );
  }

  const now = Date.now();
  const expiresIn = body.expires_in ?? 900;
  const intervalSec = body.interval ?? 5;
  const session: InternalAutomationDeploySession = {
    id: crypto.randomUUID(),
    mode,
    phase: "awaiting_login",
    steps: initialSteps(mode),
    deviceCode: {
      userCode: body.user_code,
      verificationUri: body.verification_uri,
      expiresAt: new Date(now + expiresIn * 1000).toISOString(),
      intervalSec,
    },
    appName,
    scopeMode: opts.scopeMode ?? "all",
    redirectUri,
    deviceCodeSecret: body.device_code,
    createdAtMs: now,
    expiresAtMs: now + expiresIn * 1000,
  };
  store().set(session.id, session);
  return toSnapshot(session);
}

class GraphStepError extends Error {
  readonly correlationId?: string;
  constructor(message: string, correlationId?: string) {
    super(message);
    this.correlationId = correlationId;
  }
}

async function graphReq(
  f: typeof fetch,
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; ok: boolean; json: Record<string, unknown>; correlationId?: string }> {
  const res = await f(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const correlationId = res.headers.get("request-id") ?? res.headers.get("x-ms-request-id") ?? undefined;
  const json = (res.status === 204 ? {} : await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, ok: res.ok, json, correlationId };
}

async function runAutomationProvisioningPipeline(
  session: InternalAutomationDeploySession,
  accessToken: string,
  deps: AutomationProvisionerDeps,
): Promise<void> {
  const f = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const probe = deps.testConnection ?? testAutomationConnection;

  const must = async (path: string, init?: RequestInit) => {
    const r = await graphReq(f, accessToken, path, init);
    if (!r.ok) {
      const errObj = r.json.error as { message?: string; innerError?: { "request-id"?: string } } | undefined;
      const cid = errObj?.innerError?.["request-id"] ?? r.correlationId;
      throw new GraphStepError(errObj?.message ?? `Graph ${path} returned HTTP ${r.status}`, cid);
    }
    return r;
  };

  let activeStep: AutomationDeployStepId = "tenant";
  try {
    setStep(session, "tenant", { status: "running" });
    const orgRes = await must("/organization?$select=id,displayName,verifiedDomains");
    const org = (
      orgRes.json.value as
        | Array<{
            id: string;
            displayName?: string;
            verifiedDomains?: Array<{ name: string; isDefault?: boolean }>;
          }>
        | undefined
    )?.[0];
    if (!org?.id) throw new GraphStepError("Could not discover tenant from /organization", orgRes.correlationId);
    const primaryDomain =
      org.verifiedDomains?.find((d) => d.isDefault)?.name ?? org.verifiedDomains?.[0]?.name;
    setStep(session, "tenant", {
      status: "done",
      detail: `${org.displayName ?? org.id}${primaryDomain ? ` (${primaryDomain})` : ""}`,
    });

    activeStep = "cert";
    setStep(session, "cert", { status: "running" });
    const cert = generateSelfSignedCert({ commonName: session.appName });
    setStep(session, "cert", {
      status: "done",
      detail: `SHA-1 ${cert.thumbprintSha1Hex.slice(0, 12)}… · expires ${cert.notAfterIso.slice(0, 10)}`,
    });

    activeStep = "app";
    setStep(session, "app", { status: "running" });
    const graphSpRes = await must(
      `/servicePrincipals?$filter=appId eq '${GRAPH_APP_ID}'&$select=id,appId,appRoles`,
    );
    const graphSp = (
      graphSpRes.json.value as Array<{ id: string; appRoles?: Array<{ id: string; value: string }> }> | undefined
    )?.[0];
    if (!graphSp) {
      throw new GraphStepError("Microsoft Graph service principal not found in tenant", graphSpRes.correlationId);
    }

    const scopes = await requiredAutomationScopes({ activeOnly: session.scopeMode === "active" });
    const roles = mapScopesToRoleIds(graphSp.appRoles ?? [], scopes);
    const keyCredential = {
      type: "AsymmetricX509Cert",
      usage: "Verify",
      key: cert.certDerBase64,
      displayName: `${session.appName} (${cert.notAfterIso.slice(0, 10)})`,
    };

    let appId = "";
    let appDisplayName = session.appName;
    if (session.mode === "upgrade") {
      const existingClientId = (vaultService.get("auto_clientId") ?? "").trim().replace(/'/g, "''");
      const existingRes = await must(
        `/applications?$filter=appId eq '${existingClientId}'&$select=id,appId,displayName,keyCredentials,requiredResourceAccess`,
      );
      const existing = (
        existingRes.json.value as
          | Array<{
              id: string;
              appId: string;
              displayName?: string;
              keyCredentials?: unknown[];
              requiredResourceAccess?: Array<{
                resourceAppId: string;
                resourceAccess: Array<{ id: string; type: string }>;
              }>;
            }>
          | undefined
      )?.[0];
      if (!existing) throw new GraphStepError(`Existing Automation App ${existingClientId} not found`);

      const mergedRra = buildRequiredResourceAccess(
        existing.requiredResourceAccess ?? [],
        GRAPH_APP_ID,
        roles.map((r) => r.id),
      );
      await must(`/applications/${existing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          keyCredentials: [...(existing.keyCredentials ?? []), keyCredential],
          requiredResourceAccess: mergedRra,
        }),
      });
      appId = existing.appId;
      appDisplayName = existing.displayName ?? appDisplayName;
    } else {
      const createdRes = await must("/applications", {
        method: "POST",
        body: JSON.stringify({
          displayName: session.appName,
          signInAudience: "AzureADMyOrg",
          web: { redirectUris: [session.redirectUri] },
          keyCredentials: [keyCredential],
          requiredResourceAccess: buildRequiredResourceAccess([], GRAPH_APP_ID, roles.map((r) => r.id)),
        }),
      });
      const created = createdRes.json as { appId?: string; displayName?: string };
      if (!created.appId) throw new GraphStepError("Created application missing appId", createdRes.correlationId);
      appId = created.appId;
      appDisplayName = created.displayName ?? session.appName;
    }
    setStep(session, "app", { status: "done", detail: `${appDisplayName} (${appId})` });

    activeStep = "sp";
    setStep(session, "sp", { status: "running" });
    let spId: string | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      const lookup = await must(`/servicePrincipals?$filter=appId eq '${appId}'&$select=id`);
      spId = (lookup.json.value as Array<{ id: string }> | undefined)?.[0]?.id;
      if (spId) break;
      const createSp = await graphReq(f, accessToken, "/servicePrincipals", {
        method: "POST",
        body: JSON.stringify({ appId }),
      });
      if (createSp.ok && typeof createSp.json.id === "string") {
        spId = createSp.json.id;
        break;
      }
      await sleep(1000);
    }
    if (!spId) throw new GraphStepError("Failed to provision Enterprise Service Principal for Automation app");
    setStep(session, "sp", { status: "done", detail: `Service Principal ${spId}` });

    activeStep = "grants";
    setStep(session, "grants", { status: "running" });
    const granted: string[] = [];
    for (const role of roles) {
      const assign = await graphReq(f, accessToken, `/servicePrincipals/${spId}/appRoleAssignments`, {
        method: "POST",
        body: JSON.stringify({
          principalId: spId,
          resourceId: graphSp.id,
          appRoleId: role.id,
        }),
      });
      const errMsg = (assign.json.error as { message?: string } | undefined)?.message;
      if (assign.ok || isAlreadyAssignedError(assign.status, errMsg)) {
        granted.push(role.value);
      } else {
        throw new GraphStepError(
          `Failed to grant ${role.value}: ${errMsg ?? `HTTP ${assign.status}`}`,
          assign.correlationId,
        );
      }
    }
    const missingScopes = scopes.filter((s) => !granted.includes(s));
    setStep(session, "grants", {
      status: "done",
      detail: `${granted.length}/${scopes.length} Automation scopes granted`,
    });

    activeStep = "vault";
    setStep(session, "vault", { status: "running" });
    vaultService.set("auto_tenantId", org.id);
    vaultService.set("auto_clientId", appId);
    vaultService.set("auto_clientPrivateKey", cert.privateKeyPem);
    vaultService.set("auto_certThumbprint", cert.thumbprintSha1Hex);
    vaultService.set("auto_certThumbprintX5t", cert.x5t);
    vaultService.set("auto_certPublicPem", cert.certPem);
    vaultService.set("auto_certExpiresAt", cert.notAfterIso);
    clearAutomationTokenCache();
    resetAutomationGraphClient();

    let verifiedOk = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const check = await probe();
      if (check.steps.auth.ok) {
        verifiedOk = check.ok;
        break;
      }
      if (attempt < 2) await sleep(2000);
    }

    auditDao.record({
      action: session.mode === "upgrade" ? "automation_cert_upgrade" : "automation_one_click_deploy",
      provider: AUTOMATION_PROVIDER,
      outcome: missingScopes.length === 0 ? "success" : "partial",
      detail: {
        tenantId: org.id,
        clientId: appId,
        certThumbprint: cert.thumbprintSha1Hex,
        grantedCount: granted.length,
        scopeMode: session.scopeMode,
        verifiedOk,
      },
    });

    setStep(session, "vault", {
      status: "done",
      detail: verifiedOk
        ? "Isolated keys encrypted & live certificate auth verified"
        : "Saved isolated keys (Entra key propagation may take a few seconds)",
    });

    session.result = {
      tenantId: org.id,
      tenantDisplayName: org.displayName ?? org.id,
      primaryDomain,
      clientId: appId,
      appDisplayName,
      certThumbprint: cert.thumbprintSha1Hex,
      certExpiresAt: cert.notAfterIso,
      grantedCount: granted.length,
      missingScopes,
    };
    session.phase = "succeeded";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const cid = err instanceof GraphStepError ? err.correlationId : undefined;
    setStep(session, activeStep, {
      status: "error",
      detail: message,
      ...(cid ? { correlationId: cid } : {}),
    });
    session.phase = "failed";
    session.error = message;
    session.correlationId = cid;
    auditDao.record({
      action: session.mode === "upgrade" ? "automation_cert_upgrade" : "automation_one_click_deploy",
      provider: AUTOMATION_PROVIDER,
      outcome: "error",
      detail: { step: activeStep, error: message, ...(cid ? { correlationId: cid } : {}) },
    });
  }
}

export async function pollAutomationDeploySession(
  sessionId: string,
  deps: AutomationProvisionerDeps = {},
): Promise<AutomationDeploySnapshot> {
  const session = store().get(sessionId);
  if (!session) throw new NotFoundError(`Automation deploy session ${sessionId} not found`);

  if (session.phase !== "awaiting_login") {
    return toSnapshot(session);
  }
  if (Date.now() > session.expiresAtMs) {
    session.phase = "failed";
    session.error = "Device login code expired. Start deployment again.";
    setStep(session, "login", { status: "error", detail: session.error });
    return toSnapshot(session);
  }

  const f = deps.fetch ?? fetch;
  const res = await f("https://login.microsoftonline.com/organizations/oauth2/v2.0/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: AZURE_PUBLIC_CLIENT_ID,
      device_code: session.deviceCodeSecret,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
    correlation_id?: string;
  };

  if (res.ok && body.access_token) {
    setStep(session, "login", { status: "done", detail: "Admin sign-in verified" });
    session.phase = "running";
    if (!session.pipelineStarted) {
      session.pipelineStarted = true;
      const p = runAutomationProvisioningPipeline(session, body.access_token, deps);
      if (deps.waitForPipeline) await p;
      else void p;
    }
    return toSnapshot(session);
  }

  if (body.error === "authorization_pending") {
    return toSnapshot(session);
  }
  if (body.error === "slow_down" && session.deviceCode) {
    session.deviceCode.intervalSec += 5;
    return toSnapshot(session);
  }

  const errMsg =
    body.error_description?.split(/\r?\n/)[0] ?? body.error ?? `Device login failed (${res.status})`;
  setStep(session, "login", {
    status: "error",
    detail: errMsg,
    ...(body.correlation_id ? { correlationId: body.correlation_id } : {}),
  });
  session.phase = "failed";
  session.error = errMsg;
  session.correlationId = body.correlation_id;
  return toSnapshot(session);
}
