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
