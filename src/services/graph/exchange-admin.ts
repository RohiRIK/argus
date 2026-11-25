import { signClientAssertion } from "./cert";
import { isAlreadyAssignedError } from "@/lib/graph-consent";

const EXCHANGE_APP_ID = "00000002-0000-0ff1-ce00-000000000000";
const EXCHANGE_MANAGE_AS_APP_ROLE_ID = "dc50a0fb-09a3-484d-be87-e023b12c6440";
const EXCHANGE_ADMIN_ROLE_ID = "29232cdf-9323-42fd-ade2-1d097af3e4de";
const SYSTEM_ANCHOR_MAILBOX = "SystemMailbox{bb558c35-97f1-4cb9-8ff7-d53741dc928c}";

export interface ExoProvisionResult {
  ok: boolean;
  created: boolean;
  alreadyExisted: boolean;
  address: string;
  note: string;
  error?: string;
}

export interface ExoProvisionOptions {
  tenantId: string;
  onmicrosoftDomain?: string;
  anchorFallback?: string;
  appId: string;
  spId: string;
  privateKeyPem: string;
  x5t: string;
  adminAccessToken: string;
  mailboxAddress: string;
  displayName?: string;
}

export interface ExoProvisionDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

function extractErrorText(status: number, rawText: string): string {
  if (!rawText) return `HTTP ${status}`;
  try {
    const parsed = JSON.parse(rawText) as {
      error?: { message?: string };
      error_description?: string;
      message?: string;
    };
    const msg =
      parsed.error?.message ??
      parsed.error_description?.split(/\r?\n/)[0] ??
      parsed.message;
    if (msg) return msg.trim();
  } catch {
    /* non-JSON body */
  }
  return rawText.slice(0, 240).trim();
}

/**
 * Provision an unlicensed Exchange Online Shared Mailbox over HTTPS using temporary
 * `Exchange.ManageAsApp` + `Exchange Administrator` privileges granted to Argus's
 * own Service Principal, then revoke both privileges unconditionally in `finally`.
 */
export async function provisionSharedMailboxViaExo(
  opts: ExoProvisionOptions,
  deps: ExoProvisionDeps = {},
): Promise<ExoProvisionResult> {
  const f = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const address = opts.mailboxAddress.trim();
  const alias = address.split("@")[0]?.replace(/[^a-zA-Z0-9._-]/g, "") || "argus";
  const displayName = opts.displayName?.trim() || "Argus Reports";

  let exoAppRoleAssignmentId: string | undefined;
  let dirRoleAssignmentId: string | undefined;

  const graphCall = async (path: string, init?: RequestInit) => {
    const res = await f(`https://graph.microsoft.com/v1.0${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${opts.adminAccessToken}`,
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const text = res.status === 204 ? "" : await res.text().catch(() => "");
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* ignore non-JSON */
    }
    return { status: res.status, ok: res.ok, json, rawText: text };
  };

  try {
    // 1. Locate Office 365 Exchange Online SP + Exchange.ManageAsApp role in tenant
    const exoSpRes = await graphCall(
      `/servicePrincipals?$filter=appId eq '${EXCHANGE_APP_ID}'&$select=id,appRoles`,
    );
    if (!exoSpRes.ok) {
      const errMsg = extractErrorText(exoSpRes.status, exoSpRes.rawText);
      return {
        ok: false,
        created: false,
        alreadyExisted: false,
        address,
        note: "Could not look up Office 365 Exchange Online service principal.",
        error: errMsg,
      };
    }
    const exoSp = (
      exoSpRes.json.value as
        | Array<{ id?: string; appRoles?: Array<{ id?: string; value?: string }> }>
        | undefined
    )?.[0];
    if (!exoSp?.id) {
      return {
        ok: false,
        created: false,
        alreadyExisted: false,
        address,
        note: "Exchange Online service principal not found in tenant",
        error: "Exchange Online service principal not found in tenant",
      };
    }
    const manageAsAppRoleId =
      exoSp.appRoles?.find((r) => r.value === "Exchange.ManageAsApp")?.id ??
      EXCHANGE_MANAGE_AS_APP_ROLE_ID;

    // 2. Temporarily grant Exchange.ManageAsApp to Argus's Service Principal
    const grantRes = await graphCall(
      `/servicePrincipals/${encodeURIComponent(opts.spId)}/appRoleAssignments`,
      {
        method: "POST",
        body: JSON.stringify({
          principalId: opts.spId,
          resourceId: exoSp.id,
          appRoleId: manageAsAppRoleId,
        }),
      },
    );
    const grantErr = (grantRes.json.error as { message?: string } | undefined)?.message;
    if (grantRes.ok) {
      if (typeof grantRes.json.id === "string") exoAppRoleAssignmentId = grantRes.json.id;
    } else if (!isAlreadyAssignedError(grantRes.status, grantErr ?? grantRes.rawText)) {
      return {
        ok: false,
        created: false,
        alreadyExisted: false,
        address,
        note: "Could not temporarily assign Exchange.ManageAsApp.",
        error: grantErr ?? extractErrorText(grantRes.status, grantRes.rawText),
      };
    }

    // 3. Temporarily assign Exchange Administrator directory role to Argus's SP
    const roleRes = await graphCall("/roleManagement/directory/roleAssignments", {
      method: "POST",
      body: JSON.stringify({
        "@odata.type": "#microsoft.graph.unifiedRoleAssignment",
        principalId: opts.spId,
        roleDefinitionId: EXCHANGE_ADMIN_ROLE_ID,
        directoryScopeId: "/",
      }),
    });
    const roleErr = (roleRes.json.error as { message?: string } | undefined)?.message;
    if (roleRes.ok) {
      if (typeof roleRes.json.id === "string") dirRoleAssignmentId = roleRes.json.id;
    } else if (!isAlreadyAssignedError(roleRes.status, roleErr ?? roleRes.rawText)) {
      return {
        ok: false,
        created: false,
        alreadyExisted: false,
        address,
        note: "Could not temporarily assign Exchange Administrator role.",
        error: roleErr ?? extractErrorText(roleRes.status, roleRes.rawText),
      };
    }

    // 4. Acquire Exchange Online app token + invoke New-Mailbox -Shared with propagation retries
    const systemAnchor = opts.onmicrosoftDomain
      ? `UPN:${SYSTEM_ANCHOR_MAILBOX}@${opts.onmicrosoftDomain}`
      : undefined;
    const fallbackAnchor = opts.anchorFallback ? `UPN:${opts.anchorFallback}` : undefined;
    let activeAnchor = systemAnchor ?? fallbackAnchor ?? `UPN:${address}`;
    let lastError = "Exchange Online Admin API did not succeed.";

    const maxAttempts = 6;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const tokenRes = await f(
        `https://login.microsoftonline.com/${encodeURIComponent(opts.tenantId)}/oauth2/v2.0/token`,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: opts.appId,
            scope: "https://outlook.office365.com/.default",
            grant_type: "client_credentials",
            client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
            client_assertion: signClientAssertion({
              tenantId: opts.tenantId,
              clientId: opts.appId,
              privateKeyPem: opts.privateKeyPem,
              x5t: opts.x5t,
            }),
          }),
        },
      );
      const tokenText = await tokenRes.text().catch(() => "");
      let tokenJson: { access_token?: string } = {};
      try {
        tokenJson = tokenText ? (JSON.parse(tokenText) as { access_token?: string }) : {};
      } catch {
        /* ignore */
      }

      if (!tokenRes.ok || !tokenJson.access_token) {
        lastError = extractErrorText(tokenRes.status, tokenText);
        if (attempt < maxAttempts - 1) await sleep(3000);
        continue;
      }

      const exoRes = await f(
        `https://outlook.office365.com/adminapi/beta/${encodeURIComponent(opts.tenantId)}/InvokeCommand`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokenJson.access_token}`,
            "Content-Type": "application/json; charset=UTF-8",
            "X-AnchorMailbox": activeAnchor,
          },
          body: JSON.stringify({
            CmdletInput: {
              CmdletName: "New-Mailbox",
              Parameters: {
                Shared: true,
                Name: displayName,
                DisplayName: displayName,
                Alias: alias,
                PrimarySmtpAddress: address,
              },
            },
          }),
        },
      );

      if (exoRes.ok) {
        return {
          ok: true,
          created: true,
          alreadyExisted: false,
          address,
          note: `Created free Shared Mailbox ${address} in Exchange Online`,
        };
      }

      const exoBody = await exoRes.text().catch(() => "");
      lastError = extractErrorText(exoRes.status, exoBody);

      if (/already\s*exists?|already\s*being\s*used|proxy\s*address.*already/i.test(lastError)) {
        return {
          ok: true,
          created: false,
          alreadyExisted: true,
          address,
          note: `Shared Mailbox ${address} already exists in Exchange Online`,
        };
      }

      if (
        fallbackAnchor &&
        activeAnchor === systemAnchor &&
        /anchor|SystemMailbox|routing/i.test(lastError)
      ) {
        activeAnchor = fallbackAnchor;
      }

      if (exoRes.status === 401 || exoRes.status === 403 || exoRes.status >= 500) {
        if (attempt < maxAttempts - 1) await sleep(3000);
        continue;
      }

      break;
    }

    return {
      ok: false,
      created: false,
      alreadyExisted: false,
      address,
      note: `Could not automatically create Shared Mailbox ${address}.`,
      error: lastError,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      created: false,
      alreadyExisted: false,
      address,
      note: `Could not automatically create Shared Mailbox ${address}.`,
      error: msg,
    };
  } finally {
    if (dirRoleAssignmentId) {
      await graphCall(
        `/roleManagement/directory/roleAssignments/${encodeURIComponent(dirRoleAssignmentId)}`,
        { method: "DELETE" },
      ).catch(() => {});
    }
    if (exoAppRoleAssignmentId) {
      await graphCall(
        `/servicePrincipals/${encodeURIComponent(opts.spId)}/appRoleAssignments/${encodeURIComponent(exoAppRoleAssignmentId)}`,
        { method: "DELETE" },
      ).catch(() => {});
    }
  }
}
