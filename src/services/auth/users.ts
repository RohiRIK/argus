import { randomInt } from "node:crypto";
import { usersDao, type UserSummary } from "@/db/dao/users";
import { auditDao } from "@/db/dao/audit";
import { settingsDao } from "@/db/dao/settings";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { ROLE_LABEL, type Role } from "@/lib/auth/roles";
import type { EmailTransport } from "@/services/dispatch/email";
import { getEntraUser } from "@/services/graph/groups";
import { hashPassword, validateUsername, clearFailures } from "./accounts";
import { accountMailSender, accountMailTransport } from "./mail";

/**
 * Admin user management (the Users page). Every change is written to the audit log
 * with the acting user, so it shows in Activity → Logs & events.
 *
 * - People from Entra ID are invited by email and sign in with Microsoft.
 * - Password accounts get a one-time password by email (never shown to the admin);
 *   at their first sign-in they must choose their own before anything else works.
 *
 * Guards: the last active admin can never be removed, disabled or demoted, and an
 * admin cannot remove themselves.
 */

export interface AccountMailDeps {
  fetchEntraUser?: typeof getEntraUser;
  transport?: EmailTransport;
}

/** Result of anything that emails the user: the account change happened even if the email didn't. */
export interface MailResult {
  emailSent: boolean;
  /** Why the email wasn't sent (no sender mailbox, send failed). */
  emailError?: string;
}

function record(action: string, actor: string, username: string, extra: Record<string, unknown> = {}) {
  auditDao.record({ action, outcome: "success", detail: { username, actor, ...extra } });
}

function mustFind(id: string) {
  const u = usersDao.findById(id);
  if (!u) throw new NotFoundError("User not found");
  return u;
}

function summary<T extends { passwordHash: string }>(u: T): Omit<T, "passwordHash"> {
  const { passwordHash: _omit, ...rest } = u;
  return rest;
}

function isLastActiveAdmin(u: { role: Role; disabledAt: string | null }): boolean {
  return u.role === "admin" && !u.disabledAt && usersDao.countActiveAdmins() <= 1;
}

const LAST_ADMIN = "Argus needs at least one active admin. Make someone else an admin first.";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/** 14 characters from an unambiguous alphabet (~80 bits), generated on the server only. */
export function oneTimePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 14 }, () => alphabet[randomInt(alphabet.length)]).join("");
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function orgName(): string {
  return settingsDao.get().organizationDisplayName ?? "";
}

function layout(body: string): string {
  return `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;color:#1f2328;line-height:1.5">${body}</body></html>`;
}

function button(href: string, label: string): string {
  return `<p><a href="${escapeHtml(href)}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px">${label}</a></p>`;
}

/** The invitation email for someone added from Entra ID. */
export function invitationEmail(input: { name: string; role: Role; inviter: string; org: string; signInUrl: string }) {
  const forOrg = input.org ? ` for ${input.org}` : "";
  return {
    subject: `You're invited to Argus${forOrg}`,
    html: layout(
      `<p>Hi ${escapeHtml(input.name)},</p>
<p>${escapeHtml(input.inviter)} invited you to <strong>Argus</strong>${escapeHtml(forOrg)} as <strong>${ROLE_LABEL[input.role]}</strong>.</p>
${button(input.signInUrl, "Accept invitation")}
<p style="color:#57606a;font-size:13px">Use <em>Sign in with Microsoft</em> with your work account. If the button doesn't work, open ${escapeHtml(input.signInUrl)}.</p>`,
    ),
  };
}

/** The one-time password email for a password account (new account or reset). */
export function oneTimePasswordEmail(input: {
  username: string;
  password: string;
  role: Role;
  inviter: string;
  org: string;
  signInUrl: string;
  reset: boolean;
}) {
  const forOrg = input.org ? ` for ${input.org}` : "";
  const intro = input.reset
    ? `${escapeHtml(input.inviter)} reset your <strong>Argus</strong> password.`
    : `${escapeHtml(input.inviter)} created an <strong>Argus</strong> account for you${escapeHtml(forOrg)} as <strong>${ROLE_LABEL[input.role]}</strong>.`;
  return {
    subject: input.reset ? "Your new Argus one-time password" : `Your Argus account${forOrg}`,
    html: layout(
      `<p>Hi,</p>
<p>${intro}</p>
<table style="border-collapse:collapse;margin:12px 0">
<tr><td style="padding:4px 12px 4px 0;color:#57606a">Username</td><td style="font-family:Consolas,monospace">${escapeHtml(input.username)}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#57606a">One-time password</td><td style="font-family:Consolas,monospace;font-size:15px"><strong>${escapeHtml(input.password)}</strong></td></tr>
</table>
${button(input.signInUrl, "Sign in")}
<p style="color:#57606a;font-size:13px">This password works once. Right after you sign in, Argus asks you to choose your own password.</p>`,
    ),
  };
}

async function sendAccountEmail(to: string, mail: { subject: string; html: string }, deps: AccountMailDeps): Promise<MailResult> {
  const from = accountMailSender();
  if (!from) return { emailSent: false, emailError: "No sender mailbox is set up (Settings → Integrations)." };
  try {
    await (deps.transport ?? accountMailTransport()).send({ from, to: [to], ...mail });
    return { emailSent: true };
  } catch (err) {
    return { emailSent: false, emailError: err instanceof Error ? err.message : "Sending failed" };
  }
}

export function listUsers(): UserSummary[] {
  return usersDao.list();
}

/**
 * Add a password account for an email address and email them a one-time password.
 * Their username is the email address. The password is never returned to the admin.
 */
export async function createLocalUser(
  input: { email: string; role: Role },
  actor: string,
  origin: string,
  deps: AccountMailDeps = {},
): Promise<{ user: UserSummary } & MailResult> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new ValidationError("Invalid email", { email: "Enter a valid email address" });
  const username = validateUsername(email);
  if (usersDao.findByUsername(username)) throw new ConflictError(`A user named "${username}" already exists`);
  const password = oneTimePassword();
  const created = usersDao.create(username, await hashPassword(password), {
    role: input.role,
    email,
    mustChangePassword: true,
  });
  record("user.create", actor, created.username, { role: ROLE_LABEL[input.role] });
  const mail = oneTimePasswordEmail({
    username,
    password,
    role: input.role,
    inviter: actor,
    org: orgName(),
    signInUrl: `${origin}/login`,
    reset: false,
  });
  return { user: summary(created), ...(await sendAccountEmail(email, mail, deps)) };
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

  // Disabling signs the user out everywhere, so re-enabling never revives old sessions.
  if (patch.disabled === true && !user.disabledAt) usersDao.revokeSessions(id);
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
  return summary(next);
}

/** Replace a password account's password with a new one-time password and email it. */
export async function resetUserPassword(
  id: string,
  actor: string,
  origin: string,
  deps: AccountMailDeps = {},
): Promise<MailResult> {
  const user = mustFind(id);
  if (user.authSource === "entra") {
    throw new ValidationError("This user signs in with Microsoft and has no Argus password.");
  }
  const to = user.email ?? (EMAIL_RE.test(user.username) ? user.username : null);
  if (!to) throw new ValidationError("This account has no email address to send a one-time password to.");
  const password = oneTimePassword();
  usersDao.setPassword(id, await hashPassword(password), true);
  usersDao.revokeSessions(id);
  clearFailures(user.username);
  record("user.password_reset", actor, user.username);
  const mail = oneTimePasswordEmail({
    username: user.username,
    password,
    role: user.role,
    inviter: actor,
    org: orgName(),
    signInUrl: `${origin}/login`,
    reset: true,
  });
  return sendAccountEmail(to, mail, deps);
}

/**
 * Sign a user out of every browser and device. Works for password and Microsoft
 * users; each session ends on its next request. Admins can do this to themselves too.
 */
export function signOutEverywhere(id: string, actor: string): UserSummary {
  const user = mustFind(id);
  usersDao.revokeSessions(id);
  record("user.sessions_revoked", actor, user.username);
  return summary(usersDao.findById(id)!);
}

export function deleteUser(id: string, actor: string): void {
  const user = mustFind(id);
  if (user.username === actor) throw new ValidationError("You can't remove your own account.");
  if (isLastActiveAdmin(user)) throw new ValidationError(LAST_ADMIN);
  usersDao.delete(id);
  record("user.delete", actor, user.username);
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
  deps: AccountMailDeps = {},
): Promise<{ user: UserSummary } & MailResult> {
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
  if (!input.sendEmail) return { user: summary(created), emailSent: false };
  const mail = invitationEmail({ name: e.displayName, role: input.role, inviter: actor, org: orgName(), signInUrl: `${origin}/login` });
  return { user: summary(created), ...(await sendAccountEmail(e.email, mail, deps)) };
}

/** Send the invitation email again (pending Microsoft users only). */
export async function resendInvite(id: string, actor: string, origin: string, deps: AccountMailDeps = {}): Promise<MailResult> {
  const user = mustFind(id);
  if (user.authSource !== "entra" || user.lastLoginAt) {
    throw new ValidationError("Only people who haven't accepted their invitation yet can be re-invited.");
  }
  usersDao.update(id, { invitedAt: new Date().toISOString() });
  const mail = invitationEmail({
    name: user.displayName ?? user.username,
    role: user.role,
    inviter: actor,
    org: orgName(),
    signInUrl: `${origin}/login`,
  });
  const res = await sendAccountEmail(user.email ?? user.username, mail, deps);
  if (res.emailSent) record("user.invite_resent", actor, user.username);
  return res;
}
