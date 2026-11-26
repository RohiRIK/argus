import { usersDao, type UserSummary } from "@/db/dao/users";
import { auditDao } from "@/db/dao/audit";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { ROLE_LABEL, type Role } from "@/lib/auth/roles";
import { hashPassword, validatePassword, validateUsername, clearFailures } from "./accounts";
import { getEntraUser } from "@/services/graph/groups";
import { liveEmailTransport, type EmailTransport } from "@/services/dispatch/email";
import { effectiveSender } from "@/services/graph/capabilities";
import { settingsDao } from "@/db/dao/settings";

/**
 * Admin user management (the Users page). Every change is written to the
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

export interface InviteDeps {
  fetchEntraUser?: typeof getEntraUser;
  transport?: EmailTransport;
}

export interface InviteResult {
  user: UserSummary;
  emailSent: boolean;
  /** Why the email was not sent (no sender mailbox, send failed) — the account still exists. */
  emailError?: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The invitation email: who invited them, their role, and a link to sign in with Microsoft. */
export function invitationEmail(input: { name: string; role: Role; inviter: string; org: string; signInUrl: string }) {
  const subject = `You're invited to Argus${input.org ? ` for ${input.org}` : ""}`;
  const html = `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;color:#1f2328;line-height:1.5">
<p>Hi ${escapeHtml(input.name)},</p>
<p>${escapeHtml(input.inviter)} invited you to <strong>Argus</strong>${input.org ? ` for ${escapeHtml(input.org)}` : ""} as <strong>${ROLE_LABEL[input.role]}</strong>.</p>
<p><a href="${escapeHtml(input.signInUrl)}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px">Accept invitation</a></p>
<p style="color:#57606a;font-size:13px">Use <em>Sign in with Microsoft</em> with your work account. If the button doesn't work, open ${escapeHtml(input.signInUrl)}.</p>
</body></html>`;
  return { subject, html };
}

async function sendInvitation(
  user: { displayName: string | null; username: string; email: string | null; role: Role },
  actor: string,
  origin: string,
  transport: EmailTransport,
): Promise<{ emailSent: boolean; emailError?: string }> {
  const to = user.email ?? user.username;
  const from = effectiveSender().address;
  if (!from) return { emailSent: false, emailError: "No sender mailbox is set up (Settings → Integrations)." };
  const { subject, html } = invitationEmail({
    name: user.displayName ?? to,
    role: user.role,
    inviter: actor,
    org: settingsDao.get().organizationDisplayName ?? "",
    signInUrl: `${origin}/login`,
  });
  try {
    await transport.send({ from, to: [to], subject, html });
    return { emailSent: true };
  } catch (err) {
    return { emailSent: false, emailError: err instanceof Error ? err.message : "Sending failed" };
  }
}

/**
 * Add a person from Entra ID with a role and (optionally) email them an invitation.
 * They stay "Invited" until their first Microsoft sign-in, which only works because
 * this account exists (matched by Entra object id).
 */
export async function inviteEntraUser(
  input: { entraId: string; role: Role; sendEmail: boolean },
  actor: string,
  origin: string,
  deps: InviteDeps = {},
): Promise<InviteResult> {
  if (usersDao.findByEntraOid(input.entraId)) throw new ConflictError("That person is already in Argus");
  const e = await (deps.fetchEntraUser ?? getEntraUser)(input.entraId);
  const username = e.userPrincipalName.trim().toLowerCase();
  if (usersDao.findByUsername(username)) throw new ConflictError(`A user named "${username}" already exists`);
  const created = usersDao.create(username, "", {
    role: input.role,
    authSource: "entra",
    entraOid: e.id,
    displayName: e.displayName,
    email: e.email,
    invitedAt: new Date().toISOString(),
  });
  record("user.invite", actor, created.username, { role: ROLE_LABEL[input.role] });
  const { passwordHash: _omit, ...summary } = created;
  if (!input.sendEmail) return { user: summary, emailSent: false };
  return { user: summary, ...(await sendInvitation(created, actor, origin, deps.transport ?? liveEmailTransport)) };
}

/** Send the invitation email again (pending Microsoft users only). */
export async function resendInvite(
  id: string,
  actor: string,
  origin: string,
  deps: InviteDeps = {},
): Promise<{ emailSent: boolean; emailError?: string }> {
  const user = mustFind(id);
  if (user.authSource !== "entra" || user.lastLoginAt) {
    throw new ValidationError("Only people who haven't accepted their invitation yet can be re-invited.");
  }
  usersDao.update(id, { invitedAt: new Date().toISOString() });
  const res = await sendInvitation(user, actor, origin, deps.transport ?? liveEmailTransport);
  if (res.emailSent) record("user.invite_resent", actor, user.username);
  return res;
}
