/**
 * Role-based access (admin > operator > viewer), enforced centrally in the proxy.
 *
 * - viewer:   read everything that is not a secret.
 * - operator: create, edit and run report jobs and automation policies (Audit only;
 *             Enforce is checked in the automation routes, since it depends on the body).
 * - admin:    everything, including users, integrations, secrets and tenant writes.
 *
 * One table decides the minimum role per request; anything not listed falls back to
 * "viewer for reads, operator for writes".
 */
export type Role = "admin" | "operator" | "viewer";

export const ROLES: readonly Role[] = ["admin", "operator", "viewer"];

export const ROLE_LABEL: Record<Role, string> = { admin: "Admin", operator: "Operator", viewer: "Viewer" };

export const ROLE_DESCRIPTION: Record<Role, string> = {
  admin: "Everything, including users, integrations and switching automations to Enforce.",
  operator: "Create, edit and run reports and automations (Audit mode only).",
  viewer: "Read-only: dashboard, activity, catalog and reports.",
};

const RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };

export function hasRole(actual: Role, required: Role): boolean {
  return RANK[actual] >= RANK[required];
}

/** Highest of several roles (e.g. a user in more than one Entra group). */
export function highestRole(roles: Iterable<Role>): Role | null {
  let best: Role | null = null;
  for (const r of roles) if (!best || RANK[r] > RANK[best]) best = r;
  return best;
}

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

type Rule = { test: RegExp; methods?: readonly string[]; role: Role };

const ANY_ID = "[^/]+";

/** First matching rule wins. Paths are API paths; pages are always readable (viewer). */
const RULES: readonly Rule[] = [
  // Every role manages its own session and password.
  { test: /^\/api\/auth\//, role: "viewer" },
  // Read-only rendering used by the Template Studio preview.
  { test: /^\/api\/templates\/preview$/, methods: ["POST"], role: "viewer" },

  // Secrets, users, tenant connection and tenant writes: admin only, whatever the method.
  { test: /^\/api\/users(\/|$)/, role: "admin" },
  { test: /^\/api\/vault(\/|$)/, role: "admin" },
  { test: /^\/api\/backup$/, role: "admin" },
  { test: new RegExp(`^/api/integrations/${ANY_ID}/(authorize|consent-url|cert|deploy|connect|disconnect|grant|test)(/|$)`), role: "admin" },
  { test: new RegExp(`^/api/integrations/${ANY_ID}/`), methods: ["POST", "PUT", "PATCH", "DELETE"], role: "admin" },
  { test: /^\/api\/settings(\/|$)/, methods: ["POST", "PUT", "PATCH", "DELETE"], role: "admin" },
  { test: /^\/api\/onboarding\//, role: "admin" },
  { test: /^\/api\/automations\/provision$/, role: "admin" },
  { test: new RegExp(`^/api/automations/actions/${ANY_ID}/rollback$`), role: "admin" },
  // Recipient groups can create/modify Entra security groups.
  { test: /^\/api\/recipient-groups(\/|$)/, methods: ["POST", "PUT", "PATCH", "DELETE"], role: "admin" },
];

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Minimum role needed for this request. */
export function requiredRole(method: string, pathname: string): Role {
  const m = method.toUpperCase();
  for (const r of RULES) {
    if (r.test.test(pathname) && (!r.methods || r.methods.includes(m))) return r.role;
  }
  return READ_METHODS.has(m) ? "viewer" : "operator";
}
