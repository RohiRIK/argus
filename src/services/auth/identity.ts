import { usersDao } from "@/db/dao/users";
import { API_KEY_USER, ROLE_HEADER } from "@/lib/auth/access";
import { ROLE_LABEL, hasRole, type Role } from "@/lib/auth/roles";
import { ForbiddenError } from "@/lib/errors";

export interface Identity {
  username: string;
  role: Role;
  /** Signed in with a one-time password: must choose their own before anything else. */
  mustChangePassword: boolean;
}

/**
 * Turn an authenticated name into who-and-what-role, checked against the database on
 * every request so a role change or a disabled account takes effect immediately.
 * The machine access key and the auth-off mode act as admin. A session for a user
 * that no longer exists, or is disabled, resolves to null (= signed out).
 */
export function resolveIdentity(name: string): Identity | null {
  if (name === API_KEY_USER || name === "anonymous") return { username: name, role: "admin", mustChangePassword: false };
  const user = usersDao.findByUsername(name);
  if (!user || user.disabledAt) return null;
  return { username: user.username, role: user.role, mustChangePassword: user.mustChangePassword };
}

/**
 * Route-level role check for rules that depend on the request body (e.g. Enforce
 * mode). Reads the role the proxy set; a missing header (auth off) counts as admin.
 */
export function requireRole(req: Request, needed: Role, action: string): void {
  const role = (req.headers.get(ROLE_HEADER) as Role | null) ?? "admin";
  if (!hasRole(role, needed)) {
    throw new ForbiddenError(`Only ${ROLE_LABEL[needed]}s can ${action}. Your role is ${ROLE_LABEL[role]}.`);
  }
}
