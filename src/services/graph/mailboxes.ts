import { getSharedGraphClient, requestIdFromError } from "./client";
import { liveEmailTransport, type EmailTransport } from "@/services/dispatch/email";
import { GraphApiError } from "@/lib/errors";

export interface TenantMailbox {
  id: string;
  displayName: string;
  address: string;
  userPrincipalName: string;
  hasLicense: boolean;
}

export interface MailboxVerifyResult {
  exists: boolean;
  address: string;
  displayName?: string;
  hasLicense?: boolean;
  note: string;
}

interface GraphMailboxClient {
  api(path: string): {
    select(s: string): {
      top?(n: number): { get(): Promise<unknown> };
      get(): Promise<unknown>;
    };
    top?(n: number): { get(): Promise<unknown> };
    get(): Promise<unknown>;
  };
}

export interface MailboxGraphDeps {
  client?: GraphMailboxClient;
  transport?: EmailTransport;
}

interface RawGraphUser {
  id?: string;
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
  assignedLicenses?: unknown[];
}

function getClient(deps: MailboxGraphDeps): GraphMailboxClient {
  return deps.client ?? (getSharedGraphClient() as unknown as GraphMailboxClient);
}

/**
 * List candidate sender mailboxes from Entra ID (`/users`).
 * Licensed users and Shared Mailboxes (user objects with mail/UPN) appear here.
 */
export async function listTenantMailboxes(deps: MailboxGraphDeps = {}): Promise<TenantMailbox[]> {
  const client = getClient(deps);
  try {
    const req = client.api("/users").select("id,displayName,mail,userPrincipalName,assignedLicenses");
    const res = (req.top ? await req.top(50).get() : await req.get()) as { value?: RawGraphUser[] };
    const out: TenantMailbox[] = [];
    const seen = new Set<string>();
    for (const u of res?.value ?? []) {
      const address = (u.mail || u.userPrincipalName || "").trim();
      const upn = (u.userPrincipalName ?? "").trim();
      if (!address.includes("@") || address.includes("#EXT#") || upn.includes("#EXT#")) continue;
      const key = address.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: u.id ?? address,
        displayName: u.displayName ?? address,
        address,
        userPrincipalName: u.userPrincipalName ?? address,
        hasLicense: Array.isArray(u.assignedLicenses) && u.assignedLicenses.length > 0,
      });
    }
    return out.sort((a, b) => a.address.localeCompare(b.address));
  } catch (err) {
    const e = err as { statusCode?: number; message?: string };
    throw new GraphApiError(`Failed to list tenant mailboxes: ${e.message ?? String(err)}`, {
      graphStatus: e.statusCode,
      requestId: requestIdFromError(err),
      cause: err,
    });
  }
}

/**
 * Check whether a mailbox/user UPN exists in Entra ID / Exchange Online so we
 * fail fast before saving or sending test mail.
 */
export async function verifyMailbox(
  address: string,
  deps: MailboxGraphDeps = {},
): Promise<MailboxVerifyResult> {
  const trimmed = address.trim();
  if (!trimmed) {
    return { exists: false, address: trimmed, note: "Mailbox address is empty." };
  }
  const client = getClient(deps);
  try {
    const u = (await client
      .api(`/users/${encodeURIComponent(trimmed)}`)
      .select("id,displayName,mail,userPrincipalName,assignedLicenses")
      .get()) as RawGraphUser;
    const hasLicense = Array.isArray(u.assignedLicenses) && u.assignedLicenses.length > 0;
    const resolved = (u.mail || u.userPrincipalName || trimmed).trim();
    return {
      exists: true,
      address: resolved,
      displayName: u.displayName ?? resolved,
      hasLicense,
      note: hasLicense
        ? `Verified licensed mailbox (${resolved}).`
        : `Verified shared/unlicensed account (${resolved}).`,
    };
  } catch (err) {
    const e = err as { statusCode?: number; message?: string };
    if (e?.statusCode === 404) {
      return {
        exists: false,
        address: trimmed,
        note: "Mailbox not found in Entra ID / Exchange yet.",
      };
    }
    throw new GraphApiError(`Could not verify mailbox ${trimmed}: ${e.message ?? String(err)}`, {
      graphStatus: e.statusCode,
      requestId: requestIdFromError(err),
      cause: err,
    });
  }
}

/**
 * Exchange Online PowerShell setup script:
 * 1. Creates a free unlicensed Shared Mailbox (idempotent).
 * 2. Registers an Exchange Service Principal + Management Scope + Application
 *    RBAC assignment restricting `Application Mail.Send` to ONLY that mailbox.
 */
export function buildSharedMailboxScript(opts: {
  address: string;
  displayName?: string;
  appId?: string;
  appDisplayName?: string;
}): string {
  const address = opts.address.trim() || "argus@yourdomain.com";
  const alias = address.split("@")[0]?.replace(/[^a-zA-Z0-9._-]/g, "") || "argus";
  const displayName = (opts.displayName?.trim() || "Argus Reports").replace(/'/g, "''");
  const appId = opts.appId?.trim() || "<YOUR_APP_CLIENT_ID>";
  const appName = (opts.appDisplayName?.trim() || "Argus M365").replace(/'/g, "''");
  const scopeName = `Argus-${alias}-Scope`;

  return [
    `# Exchange Online Shared Mailbox + Least-Privilege Application Mail.Send RBAC`,
    `# Requires ExchangeOnlineManagement module (Install-Module ExchangeOnlineManagement)`,
    `Connect-ExchangeOnline -ShowBanner:$false`,
    ``,
    `$mailbox = '${address}'`,
    `$existing = Get-Mailbox -Identity $mailbox -ErrorAction SilentlyContinue`,
    `if (-not $existing) {`,
    `  New-Mailbox -Shared -Name '${displayName}' -DisplayName '${displayName}' -Alias '${alias}' -PrimarySmtpAddress $mailbox`,
    `  Write-Host "Created shared mailbox: $mailbox"`,
    `} else {`,
    `  Write-Host "Shared mailbox already exists: $mailbox"`,
    `}`,
    ``,
    `# Wait briefly for Entra/Exchange replication before scoping RBAC`,
    `$sp = Get-ServicePrincipal -Identity '${appId}' -ErrorAction SilentlyContinue`,
    `if (-not $sp) {`,
    `  $entraSp = (Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/servicePrincipals(appId='${appId}')").id`,
    `  New-ServicePrincipal -AppId '${appId}' -ObjectId $entraSp -DisplayName '${appName}'`,
    `}`,
    `if (-not (Get-ManagementScope -Identity '${scopeName}' -ErrorAction SilentlyContinue)) {`,
    `  New-ManagementScope -Name '${scopeName}' -RecipientRestrictionFilter "PrimarySmtpAddress -eq '$mailbox'"`,
    `}`,
    `New-ManagementRoleAssignment -Name 'Argus-MailSend-${alias}' -App '${appId}' -Role 'Application Mail.Send' -CustomResourceScope '${scopeName}'`,
    `Write-Host "Done! Return to Argus and click Verify mailbox & activate."`,
  ].join("\n");
}

/** Send a concise branded verification email using Graph `sendMail`. */
export async function sendMailboxVerificationEmail(
  opts: { from: string; to: string; orgName?: string },
  deps: MailboxGraphDeps = {},
): Promise<void> {
  const transport = deps.transport ?? liveEmailTransport;
  const org = opts.orgName?.trim() || "your tenant";
  await transport.send({
    from: opts.from.trim(),
    to: [opts.to.trim()],
    subject: "[Argus] Sender mailbox verification",
    html: [
      `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;line-height:1.5;color:#111">`,
      `<h2 style="margin:0 0 8px">Argus sender mailbox verified</h2>`,
      `<p>This test message confirms Microsoft Graph <code style="background:#f3f4f6;padding:2px 5px">Mail.Send</code> delivery for <strong>${org}</strong>.</p>`,
      `<p style="color:#555;font-size:13px">Sender: <code>${opts.from.trim()}</code></p>`,
      `</div>`,
    ].join(""),
  });
}
