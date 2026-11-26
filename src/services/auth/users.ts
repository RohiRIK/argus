import { usersDao, type UserSummary } from "@/db/dao/users";
import { auditDao } from "@/db/dao/audit";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { ROLE_LABEL, type Role } from "@/lib/auth/roles";
import { hashPassword, validatePassword, validateUsername, clearFailures } from "./accounts";

/**
 * Admin user management (Settings → Users & roles). Every change is written to the
 * audit log with the acting user, so it shows in Activity → Logs & events.
 *
 * Guards: the last active admin can never be removed, disabled or demoted, and an
 * admin cannot remove themselves. Microsoft (Entra) users get their role from Entra
 * group membership at each sign-in, so their role is not edited here.
 */

function record(action: string, actor: string, username: string, extra: Record<string, unknown> = {}) {
  auditDao.record({ action, outcome: "success", detail: { username, actor, ...extra } });
}

function mustFind(id: string) {
  const u = usersDao.findById(id);
  if (!u) throw new NotFoundError("User not found");
  return u;
}

function isLastActiveAdmin(u: { role: Role; disabledAt: string | null }): boolean {
  return u.role === "admin" && !u.disabledAt && usersDao.countActiveAdmins() <= 1;
}

const LAST_ADMIN = "Argus needs at least one active admin. Make someone else an admin first.";

export function listUsers(): UserSummary[] {
  return usersDao.list();
}

export async function createLocalUser(
  input: { username: string; password: string; role: Role },
  actor: string,
): Promise<UserSummary> {
  const username = validateUsername(input.username);
  validatePassword(input.password);
  if (usersDao.findByUsername(username)) throw new ConflictError(`A user named "${username}" already exists`);
  const created = usersDao.create(username, await hashPassword(input.password), { role: input.role });
  record("user.create", actor, created.username, { role: input.role });
  const { passwordHash: _omit, ...summary } = created;
  return summary;
}

export function updateUser(
  id: string,
  patch: { role?: Role; disabled?: boolean },
  actor: string,
): UserSummary {
  const user = mustFind(id);
  if (patch.role !== undefined && patch.role !== user.role) {
    if (user.authSource === "entra") {
      throw new ValidationError("This user's role comes from their Entra group. Change their group membership instead.");
    }
    if (patch.role !== "admin" && isLastActiveAdmin(user)) throw new ValidationError(LAST_ADMIN);
  }
  if (patch.disabled === true && !user.disabledAt) {
    if (user.username === actor) throw new ValidationError("You can't disable your own account.");
    if (isLastActiveAdmin(user)) throw new ValidationError(LAST_ADMIN);
  }

  const next = usersDao.update(id, {
    ...(patch.role !== undefined ? { role: patch.role } : {}),
    ...(patch.disabled !== undefined ? { disabledAt: patch.disabled ? new Date().toISOString() : null } : {}),
  })!;
  if (patch.role !== undefined && patch.role !== user.role) {
    record("user.role_change", actor, user.username, { from: ROLE_LABEL[user.role], to: ROLE_LABEL[patch.role] });
  }
  if (patch.disabled !== undefined && Boolean(user.disabledAt) !== patch.disabled) {
    record(patch.disabled ? "user.disable" : "user.enable", actor, user.username);
  }
  const { passwordHash: _omit, ...summary } = next;
  return summary;
}

export async function resetUserPassword(id: string, password: string, actor: string): Promise<void> {
  const user = mustFind(id);
  if (user.authSource === "entra") {
    throw new ValidationError("This user signs in with Microsoft and has no Argus password.");
  }
  validatePassword(password);
  usersDao.setPassword(id, await hashPassword(password));
  clearFailures(user.username);
  record("user.password_reset", actor, user.username);
}

export function deleteUser(id: string, actor: string): void {
  const user = mustFind(id);
  if (user.username === actor) throw new ValidationError("You can't remove your own account.");
  if (isLastActiveAdmin(user)) throw new ValidationError(LAST_ADMIN);
  usersDao.delete(id);
  record("user.delete", actor, user.username);
}
