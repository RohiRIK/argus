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

/** Microsoft Graph's well-known application id (the resource we grant roles on). */
export const GRAPH_RESOURCE_APP_ID = "00000003-0000-0000-c000-000000000000";

/**
 * Build a copy-paste Microsoft Graph PowerShell snippet that grants Argus's app
 * every required application permission, run once by a Global Admin in their OWN
 * delegated session. It resolves each scope name against the live Graph service
 * principal (no hardcoded GUIDs) and creates the app-role assignments directly —
 * so Argus itself needs NO self-management permissions. Pure string builder.
 */
export function buildConsentSetupSnippet(clientId: string, scopes: string[]): string {
  const id = clientId || "<your-app-client-id>";
  const list = scopes.length ? scopes.map((s) => `"${s}"`).join(", ") : '"Mail.Send"';
  return [
    "# Argus — grant Microsoft Graph application permissions (run once as a Global Admin)",
    'Connect-MgGraph -Scopes "Application.Read.All","AppRoleAssignment.ReadWrite.All"',
    `$clientId = "${id}"`,
    `$scopes = @(${list})`,
    `$graph = Get-MgServicePrincipal -Filter "appId eq '${GRAPH_RESOURCE_APP_ID}'"`,
    '$app   = Get-MgServicePrincipal -Filter "appId eq '+"'$clientId'"+'"',
    "foreach ($s in $scopes) {",
    '  $role = $graph.AppRoles | Where-Object { $_.Value -eq $s -and $_.AllowedMemberTypes -contains "Application" }',
    "  if ($role) {",
    "    New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $app.Id -PrincipalId $app.Id -ResourceId $graph.Id -AppRoleId $role.Id -ErrorAction SilentlyContinue | Out-Null",
    "  }",
    "}",
    'Write-Host "Done. Return to Argus and click Test Connection / Re-validate."',
  ].join("\n");
}
