import { SIGNIN_CALLBACK_PATH } from "@/lib/auth/paths";
import { getPublicOrigin } from "@/lib/request-origin";
import { hasMasterKey } from "@/config/env";
import { vaultService } from "@/services/vault/vault";
import { clearTokenCache } from "./auth";
import { resetGraphClient } from "./client";
import { generateSelfSignedCert } from "./cert";
import { buildSharedMailboxScript } from "./mailboxes";
import { requiredScopes, testConnection } from "./connection-test";
import { mapScopesToRoleIds, buildRequiredResourceAccess, GRAPH_APP_ID } from "./permissions-grant";
import { auditDao } from "@/db/dao/audit";
import { recipientGroupsDao } from "@/db/dao/recipient-groups";
import { settingsDao } from "@/db/dao/settings";
import { STANDARD_RECIPIENT_GROUPS } from "./groups";
import { directoryWritesEnabled } from "./capabilities";
import { provisionSharedMailboxViaExo } from "./exchange-admin";
import { AUTHORIZE_CALLBACK_PATH, isAlreadyAssignedError } from "@/lib/graph-consent";
import { NotFoundError, VaultError, ValidationError } from "@/lib/errors";

// Microsoft's well-known first-party public client ID (Microsoft Graph Command Line Tools)
// used for one-time delegated Device Code sign-in to provision Argus's own app registration.
const AZURE_PUBLIC_CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e";
/** Delegated scopes for the one-time Device Code sign-in. Group writes only when opted in (H2). */
export function deployScopes(directoryWrites: boolean): string {
  return [
    "Application.ReadWrite.All",
    "AppRoleAssignment.ReadWrite.All",
    "RoleManagement.ReadWrite.Directory",
    ...(directoryWrites ? ["Group.ReadWrite.All"] : []),
    "Organization.Read.All",
    "User.Read.All",
    "Directory.Read.All",
    "offline_access",
  ].join(" ");
}

const SESSION_TTL_MS = 15 * 60_000;

export type DeployStepId =
  | "login"
  | "tenant"
  | "cert"
  | "app"
  | "sp"
  | "grants"
  | "groups"
  | "mailbox"
  | "vault";
export type DeployStepStatus = "pending" | "running" | "done" | "error";

export interface DeployStep {
  id: DeployStepId;
  label: string;
  status: DeployStepStatus;
  detail?: string;
  correlationId?: string;
}

export interface DeployResult {
  tenantId: string;
  tenantDisplayName: string;
  primaryDomain?: string;
  clientId: string;
  appDisplayName: string;
  certThumbprint: string;
  certExpiresAt: string;
  mailbox: string;
  mailboxMode: "existing" | "create";
  mailboxExists: boolean;
  mailboxCreated: boolean;
  mailboxNote?: string;
  dedicatedMailboxAddress: string;
  dedicatedMailboxExists: boolean;
  sharedMailboxScript?: string;
  grantedCount: number;
  missingScopes: string[];
  candidateMailboxes: Array<{ displayName: string; address: string }>;
  provisionedGroups: Array<{ id: string; name: string; entraLinked: boolean }>;
}

export interface DeploySessionSnapshot {
  id: string;
  mode: "create" | "upgrade";
  phase: "awaiting_login" | "running" | "succeeded" | "failed";
  steps: DeployStep[];
  deviceCode?: {
    userCode: string;
    verificationUri: string;
    expiresAt: string;
    intervalSec: number;
  };
  result?: DeployResult;
  error?: string;
  correlationId?: string;
}

interface InternalDeploySession extends DeploySessionSnapshot {
  appName: string;
  mailbox?: string;
  mailboxMode: "existing" | "create";
  redirectUri: string;
  deviceCodeSecret: string;
  createdAtMs: number;
  expiresAtMs: number;
  lastPollMs: number;
  pipelineStarted?: boolean;
}

export interface ProvisionerDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  testConnection?: typeof testConnection;
  waitForPipeline?: boolean;
}

const g = globalThis as unknown as { __argusDeploySessions?: Map<string, InternalDeploySession> };
function store(): Map<string, InternalDeploySession> {
  if (!g.__argusDeploySessions) g.__argusDeploySessions = new Map();
  const now = Date.now();
  for (const [k, s] of g.__argusDeploySessions.entries()) {
    if (now - s.createdAtMs > SESSION_TTL_MS) g.__argusDeploySessions.delete(k);
  }
  return g.__argusDeploySessions;
}

function toMailNickname(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${base || "argus-group"}-${crypto.randomUUID().slice(0, 6)}`;
}

function initialSteps(mode: "create" | "upgrade"): DeployStep[] {
  return [
    { id: "login", label: "Sign in to Microsoft 365", status: "running", detail: "Waiting for device code authentication" },
    { id: "tenant", label: "Discover tenant & mailboxes", status: "pending" },
    { id: "cert", label: "Generate X.509 certificate locally", status: "pending" },
    { id: "app", label: mode === "upgrade" ? "Attach certificate to existing App Registration" : "Create Entra ID App Registration", status: "pending" },
    { id: "sp", label: "Provision Enterprise Service Principal", status: "pending" },
    { id: "grants", label: "Grant Microsoft Graph permissions", status: "pending" },
    { id: "groups", label: "Provision Entra ID recipient groups", status: "pending" },
    { id: "mailbox", label: "Create & configure sender mailbox", status: "pending" },
    { id: "vault", label: "Store encrypted keys & verify connection", status: "pending" },
  ];
}

function setStep(s: InternalDeploySession, id: DeployStepId, patch: Partial<DeployStep>) {
  const step = s.steps.find((x) => x.id === id);
  if (step) Object.assign(step, patch);
}

function toSnapshot(s: InternalDeploySession): DeploySessionSnapshot {
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

export async function startDeploySession(
  opts: {
    mode?: "create" | "upgrade";
    appName?: string;
    mailbox?: string;
    mailboxMode?: "existing" | "create";
    origin?: string;
    req?: Request;
  },
  deps: ProvisionerDeps = {},
): Promise<DeploySessionSnapshot> {
  if (!hasMasterKey()) {
    throw new VaultError("ARGUS_MASTER_KEY must be set before deploying to Microsoft 365");
  }
  const mode = opts.mode ?? "create";
  if (mode === "upgrade" && !vaultService.get("clientId")) {
    throw new ValidationError("No existing Client ID in vault to upgrade");
  }

  const origin = opts.origin ?? (opts.req ? getPublicOrigin(opts.req) : "http://localhost:8100");
  const redirectUri = `${origin}${AUTHORIZE_CALLBACK_PATH}`;
  const appName = opts.appName?.trim() || "Argus M365";
  const f = deps.fetch ?? fetch;

  const res = await f("https://login.microsoftonline.com/organizations/oauth2/v2.0/devicecode", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: AZURE_PUBLIC_CLIENT_ID,
      scope: deployScopes(directoryWritesEnabled()),
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    expires_in?: number;
    interval?: number;
    error_description?: string;
    correlation_id?: string;
  };
  if (!res.ok || !body.device_code || !body.user_code || !body.verification_uri) {
    throw new ValidationError(
      body.error_description ?? `Failed to start Microsoft device login (HTTP ${res.status})`,
    );
  }

  const now = Date.now();
  const expiresIn = body.expires_in ?? 900;
  const intervalSec = body.interval ?? 5;
  const session: InternalDeploySession = {
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
    mailbox: opts.mailbox?.trim() || undefined,
    mailboxMode: opts.mailboxMode ?? "existing",
    redirectUri,
    deviceCodeSecret: body.device_code,
    createdAtMs: now,
    expiresAtMs: now + expiresIn * 1000,
    lastPollMs: 0,
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

async function runProvisioningPipeline(
  session: InternalDeploySession,
  accessToken: string,
  deps: ProvisionerDeps,
): Promise<void> {
  const f = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const probe = deps.testConnection ?? testConnection;

  const must = async (path: string, init?: RequestInit) => {
    const r = await graphReq(f, accessToken, path, init);
    if (!r.ok) {
      const errObj = r.json.error as { message?: string; innerError?: { "request-id"?: string } } | undefined;
      const cid = errObj?.innerError?.["request-id"] ?? r.correlationId;
      throw new GraphStepError(errObj?.message ?? `Graph ${path} returned HTTP ${r.status}`, cid);
    }
    return r;
  };

  let activeStep: DeployStepId = "tenant";
  try {
    // 1. Discover tenant + signed-in admin + candidate mailboxes
    setStep(session, "tenant", { status: "running" });
    const orgRes = await must("/organization?$select=id,displayName,verifiedDomains");
    const org = (
      orgRes.json.value as
        | Array<{
            id: string;
            displayName?: string;
            verifiedDomains?: Array<{ name: string; isDefault?: boolean; isInitial?: boolean }>;
          }>
        | undefined
    )?.[0];
    if (!org?.id) throw new GraphStepError("Could not discover tenant from /organization", orgRes.correlationId);
    const primaryDomain =
      org.verifiedDomains?.find((d) => d.isDefault)?.name ?? org.verifiedDomains?.[0]?.name;
    const onmicrosoftDomain =
      org.verifiedDomains?.find((d) => d.isInitial)?.name ??
      org.verifiedDomains?.find((d) => d.name.toLowerCase().endsWith(".onmicrosoft.com"))?.name;

    const meRes = await graphReq(f, accessToken, "/me?$select=id,displayName,mail,userPrincipalName");
    const me = meRes.json as { id?: string; displayName?: string; mail?: string; userPrincipalName?: string };
    const usersRes = await graphReq(f, accessToken, "/users?$select=displayName,mail,userPrincipalName&$top=20");
    const usersList = (usersRes.json.value as Array<{ displayName?: string; mail?: string; userPrincipalName?: string }> | undefined) ?? [];
    const candidateMailboxes = usersList
      .map((u) => {
        const address = (u.mail || u.userPrincipalName || "").trim();
        const upn = (u.userPrincipalName ?? "").trim();
        return {
          displayName: u.displayName ?? u.userPrincipalName ?? "",
          address,
          isExt: address.includes("#EXT#") || upn.includes("#EXT#"),
        };
      })
      .filter((u) => u.address.includes("@") && !u.isExt)
      .map(({ displayName, address }) => ({ displayName, address }));
    const meAddress = (me.mail || me.userPrincipalName || candidateMailboxes[0]?.address || "").trim();
    const suggestedDedicated = primaryDomain ? `argus@${primaryDomain}` : meAddress;
    let dedicatedMailboxExists = Boolean(
      suggestedDedicated &&
        candidateMailboxes.some((m) => m.address.toLowerCase() === suggestedDedicated.toLowerCase()),
    );
    setStep(session, "tenant", {
      status: "done",
      detail: `${org.displayName ?? org.id}${primaryDomain ? ` (${primaryDomain})` : ""}`,
    });

    // 2. Generate X.509 certificate locally
    activeStep = "cert";
    setStep(session, "cert", { status: "running" });
    const cert = generateSelfSignedCert({ commonName: session.appName });
    setStep(session, "cert", {
      status: "done",
      detail: `SHA-1 ${cert.thumbprintSha1Hex.slice(0, 12)}… · expires ${cert.notAfterIso.slice(0, 10)}`,
    });

    // 3. Create or upgrade Entra App Registration
    activeStep = "app";
    setStep(session, "app", { status: "running" });
    const graphSpRes = await must(`/servicePrincipals?$filter=appId eq '${GRAPH_APP_ID}'&$select=id,appId,appRoles`);
    const graphSp = (graphSpRes.json.value as Array<{ id: string; appRoles?: Array<{ id: string; value: string }> }> | undefined)?.[0];
    if (!graphSp) throw new GraphStepError("Microsoft Graph service principal not found in tenant", graphSpRes.correlationId);

    const scopes = requiredScopes();
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
      const existingClientId = (vaultService.get("clientId") ?? "").trim().replace(/'/g, "''");
      const existingRes = await must(`/applications?$filter=appId eq '${existingClientId}'&$select=id,appId,displayName,keyCredentials,requiredResourceAccess`);
      const existing = (existingRes.json.value as Array<{
        id: string;
        appId: string;
        displayName?: string;
        keyCredentials?: unknown[];
        requiredResourceAccess?: Array<{ resourceAppId: string; resourceAccess: Array<{ id: string; type: string }> }>;
      }> | undefined)?.[0];
      if (!existing) throw new GraphStepError(`Existing App Registration ${existingClientId} not found`);

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
          // Admin-consent callback + Microsoft sign-in callback (same origin).
          web: { redirectUris: [session.redirectUri, session.redirectUri.replace(AUTHORIZE_CALLBACK_PATH, SIGNIN_CALLBACK_PATH)] },
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

    // 4. Ensure Service Principal exists (retry briefly for Entra replication)
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
    if (!spId) throw new GraphStepError("Failed to provision Enterprise Service Principal for the app");
    setStep(session, "sp", { status: "done", detail: `Service Principal ${spId}` });

    // 5. Grant all required Graph application permissions
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
      detail: `${granted.length}/${scopes.length} Graph permissions granted`,
    });

    // 6. Seed recipient_groups in SQLite. Entra Security Groups are created/linked
    // only when the operator opted in to directory writes (H2); otherwise local.
    activeStep = "groups";
    setStep(session, "groups", { status: "running" });
    const allowDirectoryWrites = directoryWritesEnabled();
    const existingEntraByName = new Map<string, { id: string; displayName: string }>();
    const existingGroupsRes = allowDirectoryWrites
      ? await graphReq(f, accessToken, "/groups?$select=id,displayName&$top=100")
      : { ok: false, status: 0, json: {} as Record<string, unknown>, correlationId: undefined };
    if (existingGroupsRes.ok && Array.isArray(existingGroupsRes.json.value)) {
      for (const g of existingGroupsRes.json.value as Array<{ id?: string; displayName?: string }>) {
        if (g.id && g.displayName) {
          existingEntraByName.set(g.displayName.toLowerCase(), { id: g.id, displayName: g.displayName });
        }
      }
    }

    const provisionedGroups: Array<{ id: string; name: string; entraLinked: boolean }> = [];
    for (const spec of STANDARD_RECIPIENT_GROUPS) {
      let entraGroupId: string | null = existingEntraByName.get(spec.name.toLowerCase())?.id ?? null;
      let entraDisplayName: string | null = existingEntraByName.get(spec.name.toLowerCase())?.displayName ?? null;
      let groupErr: string | null = null;

      if (!entraGroupId && allowDirectoryWrites) {
        const createdGroupRes = await graphReq(f, accessToken, "/groups", {
          method: "POST",
          body: JSON.stringify({
            displayName: spec.name,
            description: spec.description,
            mailEnabled: false,
            securityEnabled: true,
            mailNickname: toMailNickname(spec.name),
          }),
        });
        if (createdGroupRes.ok && typeof createdGroupRes.json.id === "string") {
          entraGroupId = createdGroupRes.json.id;
          entraDisplayName =
            typeof createdGroupRes.json.displayName === "string" ? createdGroupRes.json.displayName : spec.name;
        } else {
          const errObj = createdGroupRes.json.error as { message?: string } | undefined;
          groupErr = errObj?.message ?? `Entra group creation returned HTTP ${createdGroupRes.status}`;
        }
      }

      if (entraGroupId && me.id && allowDirectoryWrites) {
        const addMemberRes = await graphReq(
          f,
          accessToken,
          `/groups/${encodeURIComponent(entraGroupId)}/members/$ref`,
          {
            method: "POST",
            body: JSON.stringify({
              "@odata.id": `https://graph.microsoft.com/v1.0/directoryObjects/${me.id}`,
            }),
          },
        );
        const addErr = (addMemberRes.json.error as { message?: string } | undefined)?.message;
        if (!addMemberRes.ok && !isAlreadyAssignedError(addMemberRes.status, addErr)) {
          groupErr = addErr ?? `Could not add signed-in admin to group (${addMemberRes.status})`;
        }
      }

      const adminMember =
        entraGroupId && meAddress.includes("@")
          ? [{ id: me.id, displayName: me.displayName ?? meAddress, email: meAddress, source: "entra" as const }]
          : [];
      const localExisting = recipientGroupsDao.findByName(spec.name);
      const saved = localExisting
        ? (recipientGroupsDao.update(localExisting.id, {
            ...(entraGroupId
              ? {
                  entraGroupId,
                  entraDisplayName: entraDisplayName ?? spec.name,
                  managedByArgus: localExisting.managedByArgus || Boolean(entraGroupId),
                  lastSyncedAt: new Date().toISOString(),
                  lastSyncError: null,
                }
              : { lastSyncError: groupErr }),
            ...(entraGroupId && localExisting.cachedEntraMembers.length === 0 && adminMember.length > 0
              ? { cachedEntraMembers: adminMember }
              : {}),
          }) ?? localExisting)
        : recipientGroupsDao.create({
            name: spec.name,
            description: spec.description,
            entraGroupId,
            entraDisplayName,
            managedByArgus: Boolean(entraGroupId),
            staticMembers: [],
            cachedEntraMembers: adminMember,
            lastSyncedAt: entraGroupId ? new Date().toISOString() : null,
            lastSyncError: groupErr,
          });
      provisionedGroups.push({
        id: saved.id,
        name: saved.name,
        entraLinked: Boolean(entraGroupId),
      });
    }
    const entraGroupCount = provisionedGroups.filter((g) => g.entraLinked).length;
    setStep(session, "groups", {
      status: "done",
      detail:
        entraGroupCount > 0
          ? `${entraGroupCount}/${provisionedGroups.length} Entra ID groups ready${me.id ? " (signed-in admin added)" : ""}`
          : allowDirectoryWrites
            ? `${provisionedGroups.length} local recipient groups ready (Entra group sync skipped)`
            : `${provisionedGroups.length} local recipient groups ready (Manage Entra groups is off)`,
    });

    // 7. Create or activate dedicated Exchange Shared Mailbox automatically (fallback to admin mailbox if blocked)
    activeStep = "mailbox";
    setStep(session, "mailbox", { status: "running" });
    let resolvedMailbox = "";
    let mailboxCreated = false;
    let mailboxNote: string | undefined;

    if (session.mailbox) {
      resolvedMailbox = session.mailbox;
    } else if (dedicatedMailboxExists && suggestedDedicated) {
      resolvedMailbox = suggestedDedicated;
      mailboxNote = `Active sender: ${suggestedDedicated} (dedicated mailbox already exists)`;
      setStep(session, "mailbox", { status: "done", detail: mailboxNote });
    } else if (primaryDomain && suggestedDedicated.includes("@")) {
      setStep(session, "mailbox", {
        status: "running",
        detail: `Creating free Shared Mailbox ${suggestedDedicated} in Exchange Online…`,
      });
      const exoRes = await provisionSharedMailboxViaExo(
        {
          tenantId: org.id,
          onmicrosoftDomain,
          anchorFallback: meAddress || undefined,
          appId,
          spId,
          privateKeyPem: cert.privateKeyPem,
          x5t: cert.x5t,
          adminAccessToken: accessToken,
          mailboxAddress: suggestedDedicated,
          displayName: "Argus Reports",
        },
        { fetch: f, sleep },
      );
      if (exoRes.ok) {
        resolvedMailbox = suggestedDedicated;
        dedicatedMailboxExists = true;
        mailboxCreated = exoRes.created;
        mailboxNote = exoRes.note;
        setStep(session, "mailbox", {
          status: "done",
          detail: exoRes.created
            ? `Created & activated Shared Mailbox ${suggestedDedicated}`
            : `Activated existing Shared Mailbox ${suggestedDedicated}`,
        });
      } else {
        const prevMailbox = vaultService.get("mailbox")?.trim();
        const usablePrev =
          prevMailbox && prevMailbox.toLowerCase() !== suggestedDedicated.toLowerCase() ? prevMailbox : "";
        resolvedMailbox = usablePrev || meAddress;
        mailboxNote = `Using ${resolvedMailbox || "none"} (automatic Exchange creation skipped: ${exoRes.error ?? exoRes.note})`;
        setStep(session, "mailbox", { status: "done", detail: mailboxNote });
      }
    } else {
      resolvedMailbox = vaultService.get("mailbox") || meAddress;
      setStep(session, "mailbox", {
        status: "done",
        detail: resolvedMailbox ? `Active sender: ${resolvedMailbox}` : "No sender mailbox detected — configure in Advanced",
      });
    }

    if (session.mailbox) {
      setStep(session, "mailbox", { status: "done", detail: `Active sender: ${session.mailbox}` });
    }

    const sharedMailboxScript = !dedicatedMailboxExists
      ? buildSharedMailboxScript({
          address: suggestedDedicated || "argus@yourdomain.com",
          displayName: "Argus Reports",
          appId,
          appDisplayName,
        })
      : undefined;

    // 8. Store encrypted keys in vault + verify live cert auth (retry for key propagation)
    activeStep = "vault";
    setStep(session, "vault", { status: "running" });
    vaultService.set("tenantId", org.id);
    vaultService.set("clientId", appId);
    vaultService.set("clientPrivateKey", cert.privateKeyPem);
    vaultService.set("certThumbprint", cert.thumbprintSha1Hex);
    vaultService.set("certThumbprintX5t", cert.x5t);
    vaultService.set("certPublicPem", cert.certPem);
    vaultService.set("certExpiresAt", cert.notAfterIso);
    if (resolvedMailbox) vaultService.set("mailbox", resolvedMailbox);
    const currentSettings = settingsDao.get();
    const settingsPatch: { globalRecipients?: string[]; fromAddress?: string } = {};
    if (meAddress.includes("@") && currentSettings.globalRecipients.length === 0) {
      settingsPatch.globalRecipients = [meAddress];
    }
    if (resolvedMailbox && (!currentSettings.fromAddress || mailboxCreated)) {
      settingsPatch.fromAddress = resolvedMailbox;
    }
    if (Object.keys(settingsPatch).length > 0) {
      settingsDao.update(settingsPatch);
    }
    clearTokenCache();
    resetGraphClient();

    let verifiedOk = false;
    let lastVerifyErr: string | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      const check = await probe();
      if (check.steps.auth.ok) {
        verifiedOk = check.ok;
        break;
      }
      lastVerifyErr = check.steps.auth.error;
      if (attempt < 2) await sleep(2000);
    }

    auditDao.record({
      action: session.mode === "upgrade" ? "azure_cert_upgrade" : "azure_one_click_deploy",
      provider: "microsoft365",
      outcome: missingScopes.length === 0 ? "success" : "partial",
      detail: {
        tenantId: org.id,
        clientId: appId,
        certThumbprint: cert.thumbprintSha1Hex,
        grantedCount: granted.length,
        entraGroupsCount: entraGroupCount,
        mailbox: resolvedMailbox || null,
        mailboxCreated,
        ...(mailboxNote ? { mailboxNote } : {}),
        verifiedOk,
        ...(lastVerifyErr ? { verifyNote: lastVerifyErr } : {}),
      },
    });

    setStep(session, "vault", {
      status: "done",
      detail: verifiedOk
        ? "Encrypted keys saved & certificate auth verified live"
        : "Saved encrypted keys (Entra key propagation may take a few seconds)",
    });

    const mailboxExists = Boolean(
      resolvedMailbox &&
        (dedicatedMailboxExists ||
          candidateMailboxes.some((m) => m.address.toLowerCase() === resolvedMailbox.toLowerCase())),
    );

    session.result = {
      tenantId: org.id,
      tenantDisplayName: org.displayName ?? org.id,
      primaryDomain,
      clientId: appId,
      appDisplayName,
      certThumbprint: cert.thumbprintSha1Hex,
      certExpiresAt: cert.notAfterIso,
      mailbox: resolvedMailbox,
      mailboxMode: session.mailboxMode,
      mailboxExists,
      mailboxCreated,
      ...(mailboxNote ? { mailboxNote } : {}),
      dedicatedMailboxAddress: suggestedDedicated,
      dedicatedMailboxExists,
      ...(sharedMailboxScript ? { sharedMailboxScript } : {}),
      grantedCount: granted.length,
      missingScopes,
      candidateMailboxes,
      provisionedGroups,
    };
    session.phase = "succeeded";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const cid = err instanceof GraphStepError ? err.correlationId : undefined;
    setStep(session, activeStep, { status: "error", detail: message, ...(cid ? { correlationId: cid } : {}) });
    session.phase = "failed";
    session.error = message;
    session.correlationId = cid;
    auditDao.record({
      action: session.mode === "upgrade" ? "azure_cert_upgrade" : "azure_one_click_deploy",
      provider: "microsoft365",
      outcome: "error",
      detail: { step: activeStep, error: message, ...(cid ? { correlationId: cid } : {}) },
    });
  }
}

export async function pollDeploySession(
  sessionId: string,
  deps: ProvisionerDeps = {},
): Promise<DeploySessionSnapshot> {
  const session = store().get(sessionId);
  if (!session) throw new NotFoundError(`Deploy session ${sessionId} not found`);

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
  session.lastPollMs = Date.now();

  if (res.ok && body.access_token) {
    setStep(session, "login", { status: "done", detail: "Admin sign-in verified" });
    session.phase = "running";
    if (!session.pipelineStarted) {
      session.pipelineStarted = true;
      const p = runProvisioningPipeline(session, body.access_token, deps);
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

  const errMsg = body.error_description?.split(/\r?\n/)[0] ?? body.error ?? `Device login failed (${res.status})`;
  setStep(session, "login", { status: "error", detail: errMsg, ...(body.correlation_id ? { correlationId: body.correlation_id } : {}) });
  session.phase = "failed";
  session.error = errMsg;
  session.correlationId = body.correlation_id;
  return toSnapshot(session);
}
