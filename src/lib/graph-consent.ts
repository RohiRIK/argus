/**
 * Pure helpers for the Microsoft Graph admin-consent / permission-grant flow.
 * Kept DOM- and server-free so they can be shared by the client Settings page,
 * the server grant service, and unit tests without bundling server code.
 */

/**
 * The two scopes that must be admin-consented on the Argus app before the
 * programmatic grant (D2) can run. Until both are present, the one-click grant
 * has nothing to authenticate with and the Graph calls 403.
 */
export const BOOTSTRAP_SCOPES = ["Application.ReadWrite.All", "AppRoleAssignment.ReadWrite.All"] as const;

/** Result of parsing the admin-consent redirect return (`/settings/integrations?…`). */
export interface AdminConsentReturn {
  status: "success" | "error" | "none";
  tenant?: string;
  error?: string;
  errorDescription?: string;
}

/**
 * Parse Microsoft's admin-consent redirect query params. Microsoft returns either
 * `?admin_consent=True&tenant=<id>` on success, or `?error=…&error_description=…`
 * on failure; anything else is "none" (a normal page visit).
 */
export function parseAdminConsentReturn(params: URLSearchParams): AdminConsentReturn {
  const error = params.get("error");
  if (error) {
    return { status: "error", error, errorDescription: params.get("error_description") ?? undefined };
  }
  const consent = params.get("admin_consent");
  if (consent && consent.toLowerCase() === "true") {
    return { status: "success", tenant: params.get("tenant") ?? undefined };
  }
  return { status: "none" };
}

/** Whether both bootstrap scopes are present in the granted set, so D2 can run. */
export function hasBootstrapScopes(granted: string[]): boolean {
  const g = new Set(granted);
  return BOOTSTRAP_SCOPES.every((s) => g.has(s));
}

/**
 * Whether an appRoleAssignment POST error means the role is ALREADY assigned —
 * which is success for our purposes (idempotent grant). Graph returns `409` or a
 * `400` whose message says the assignment already exists. Pure.
 */
export function isAlreadyAssignedError(status: number | undefined, message?: string): boolean {
  if (status === 409) return true;
  if (status === 400 && message) return /already\s*exists|already\s*assigned/i.test(message);
  return false;
}

/** Microsoft Graph's well-known application id (the resource we grant roles on). */
export const GRAPH_RESOURCE_APP_ID = "00000003-0000-0000-c000-000000000000";

/** The delegated scopes an admin consents so Argus can append + grant its own app permissions. */
export const DELEGATED_ADMIN_SCOPES = [
  "offline_access",
  "openid",
  "https://graph.microsoft.com/Application.ReadWrite.All",
  "https://graph.microsoft.com/AppRoleAssignment.ReadWrite.All",
] as const;

/** Path of the OAuth callback the Authorize flow redirects to (must be registered on the app). */
export const AUTHORIZE_CALLBACK_PATH = "/api/integrations/microsoft365/authorize/callback";

/** Short-lived CSRF cookie name for the authorize round-trip. */
export const OAUTH_STATE_COOKIE = "argus_oauth_state";

/**
 * Build the delegated admin authorization-code URL. The admin signs in and consents
 * the delegated write scopes (dynamic consent — no pre-declaration needed); Argus then
 * uses that session to append + grant its application permissions. Pure.
 */
export function buildAdminAuthorizeUrl(tenantId: string, clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    response_mode: "query",
    redirect_uri: redirectUri,
    scope: DELEGATED_ADMIN_SCOPES.join(" "),
    state,
    prompt: "consent",
  });
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize?${params.toString()}`;
}

/**
 * Build a copy-paste Microsoft Graph PowerShell snippet that, run once by a Global
 * Admin in their OWN delegated session, **declares** the required application
 * permissions on the app registration (so the portal lists them) **and grants**
 * them via app-role assignments. Resolves scope names against the live Graph SP
 * (no hardcoded GUIDs); idempotent. Pure string builder.
 */
export function buildConsentSetupSnippet(clientId: string, scopes: string[]): string {
  const id = clientId || "<your-app-client-id>";
  const list = scopes.length ? scopes.map((s) => `"${s}"`).join(", ") : '"Mail.Send"';
  return [
    "# Argus — declare + grant Microsoft Graph application permissions (run once as a Global Admin)",
    'Connect-MgGraph -Scopes "Application.ReadWrite.All","AppRoleAssignment.ReadWrite.All"',
    `$clientId = "${id}"`,
    `$scopes = @(${list})`,
    `$graph = Get-MgServicePrincipal -Filter "appId eq '${GRAPH_RESOURCE_APP_ID}'"`,
    '$sp    = Get-MgServicePrincipal -Filter "appId eq '+"'$clientId'"+'"',
    '$appReg = Get-MgApplication -Filter "appId eq '+"'$clientId'"+'"',
    "$roleIds = @()",
    "foreach ($s in $scopes) {",
    '  $role = $graph.AppRoles | Where-Object { $_.Value -eq $s -and $_.AllowedMemberTypes -contains "Application" }',
    "  if ($role) {",
    "    $roleIds += $role.Id",
    "    New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -PrincipalId $sp.Id -ResourceId $graph.Id -AppRoleId $role.Id -ErrorAction SilentlyContinue | Out-Null",
    "  }",
    "}",
    "# Declare the roles on the app registration so the portal lists them",
    "$access = $roleIds | ForEach-Object { @{ Id = $_; Type = 'Role' } }",
    "$rra = @{ ResourceAppId = $graph.AppId; ResourceAccess = @($access) }",
    "Update-MgApplication -ApplicationId $appReg.Id -RequiredResourceAccess @($rra)",
    'Write-Host "Done — permissions declared + granted. Return to Argus and click Re-validate."',
  ].join("\n");
}
