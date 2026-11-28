"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Segmented, Select } from "@/components/ui/primitives";
import { RelativeTime } from "@/components/ui/relative-time";
import { ROLES, ROLE_DESCRIPTION, ROLE_LABEL, type Role } from "@/lib/auth/roles";
import { useCurrentUser } from "@/lib/use-current-user";
import { cn } from "@/lib/utils";

interface UserRow {
  id: string;
  username: string;
  role: Role;
  disabledAt: string | null;
  authSource: "local" | "entra";
  displayName: string | null;
  email: string | null;
  lastLoginAt: string | null;
  invitedAt: string | null;
}

type Notice = { tone: "ok" | "warn" | "error"; text: string } | null;

type MailResult = { emailSent: boolean; emailError?: string };

/** Tell the admin whether the email went out, without ever showing a password. */
function mailNotice(r: MailResult | undefined, sent: string, what: string): Notice {
  return r?.emailSent
    ? { tone: "ok", text: sent }
    : { tone: "warn", text: `${what}, but the email wasn't sent: ${r?.emailError ?? "unknown error"}` };
}

type Status = "active" | "invited" | "disabled";

function statusOf(u: UserRow): Status {
  if (u.disabledAt) return "disabled";
  if (u.authSource === "entra" && !u.lastLoginAt) return "invited";
  return "active";
}

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  active: { label: "Active", cls: "border-success/30 text-success" },
  invited: { label: "Invited", cls: "border-info/30 text-info" },
  disabled: { label: "Disabled", cls: "border-border text-fg-muted" },
};

async function call(url: string, init?: RequestInit): Promise<{ ok: boolean; data?: unknown; message?: string }> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const b = await res.json().catch(() => ({}));
  if (b.success) return { ok: true, data: b.data };
  const field = b.error?.fields ? (Object.values(b.error.fields)[0] as string) : undefined;
  return { ok: false, message: field ?? b.error?.message ?? `Request failed (${res.status})` };
}

/** Users page (/users, admin): one table of everyone who can sign in, with their role. */
export function UsersAdmin() {
  const me = useCurrentUser();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [adding, setAdding] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await call("/api/users");
    if (r.ok) setUsers(r.data as UserRow[]);
    else setNotice({ tone: "error", text: r.message ?? "Could not load users" });
  }, []);

  const isAdmin = me?.role === "admin";
  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  if (!me) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (!isAdmin) {
    return (
      <Card data-testid="users-not-admin">
        <CardContent className="py-6 text-sm text-fg-muted">
          Only admins can manage users. Your role is <span className="font-medium text-fg">{ROLE_LABEL[me.role]}</span>.
        </CardContent>
      </Card>
    );
  }

  async function act(fn: () => Promise<{ ok: boolean; data?: unknown; message?: string }>, success: string) {
    const r = await fn();
    setNotice(r.ok ? { tone: "ok", text: success } : { tone: "error", text: r.message ?? "Failed" });
    if (r.ok) await load();
    return r;
  }

  return (
    <Card data-testid="users-admin">
      <CardHeader>
        <CardTitle>Users</CardTitle>
        <Button
          size="sm"
          variant="primary"
          className="shrink-0 whitespace-nowrap"
          onClick={() => setAdding((v) => !v)}
          data-testid="user-add-toggle"
        >
          {adding ? "Cancel" : "Add user"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && (
          <AddUser
            onDone={async (n) => {
              setAdding(false);
              setNotice(n);
              await load();
            }}
          />
        )}

        {notice && (
          <div
            role="status"
            data-testid="users-notice"
            className={cn(
              "rounded-lg border px-3 py-2 text-xs",
              notice.tone === "ok" && "border-success/30 bg-success/5 text-fg",
              notice.tone === "warn" && "border-warning/30 bg-warning/5 text-fg",
              notice.tone === "error" && "border-danger/30 bg-danger/5 text-danger",
            )}
          >
            {notice.text}
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-border/60">
          <table className="w-full text-sm" data-testid="users-table">
            <thead className="bg-surface-2/50 text-left text-[11px] uppercase tracking-wider text-fg-muted">
              <tr>
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Last sign-in</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {(users ?? []).map((u) => {
                const self = u.username === me.username;
                const status = statusOf(u);
                const name = u.displayName ?? u.username;
                return (
                  <tr key={u.id} data-testid={`user-row-${u.username}`}>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-fg">
                        {name}
                        {self && <span className="ml-2 text-[11px] font-normal text-fg-muted">(you)</span>}
                      </div>
                      <div className="text-[11px] text-fg-muted">
                        {u.email ?? u.username} · {u.authSource === "entra" ? "Microsoft" : "Password"}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Select
                        aria-label={`Role for ${u.username}`}
                        title={ROLE_DESCRIPTION[u.role]}
                        data-testid={`user-role-${u.username}`}
                        value={u.role}
                        onChange={(e) =>
                          void act(
                            () => call(`/api/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ role: e.target.value }) }),
                            `${name} is now ${ROLE_LABEL[e.target.value as Role]}.`,
                          )
                        }
                        className="h-8 w-32 py-0 text-xs"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        data-testid={`user-status-${u.username}`}
                        className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", STATUS_META[status].cls)}
                      >
                        {STATUS_META[status].label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-fg-muted">
                      {u.lastLoginAt ? <RelativeTime iso={u.lastLoginAt} /> : "Never"}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-3 whitespace-nowrap text-xs">
                        {status === "invited" && (
                          <button
                            type="button"
                            className="text-fg-muted hover:text-fg"
                            data-testid={`user-resend-${u.username}`}
                            onClick={async () => {
                              const r = await call(`/api/users/${u.id}/invite`, { method: "POST" });
                              const d = r.data as { emailSent: boolean; emailError?: string } | undefined;
                              setNotice(
                                !r.ok
                                  ? { tone: "error", text: r.message ?? "Failed" }
                                  : mailNotice(d, `Invitation sent again to ${u.email ?? u.username}.`, "Invitation not resent"),
                              );
                            }}
                          >
                            Resend invite
                          </button>
                        )}
                        {u.authSource === "local" && (
                          <button
                            type="button"
                            className="text-fg-muted hover:text-fg"
                            data-testid={`user-reset-${u.username}`}
                            onClick={async () => {
                              const r = await call(`/api/users/${u.id}/password`, { method: "POST" });
                              setNotice(
                                r.ok
                                  ? mailNotice(r.data as MailResult, `Emailed a new one-time password to ${u.email ?? u.username}.`, "Password reset")
                                  : { tone: "error", text: r.message ?? "Failed" },
                              );
                            }}
                          >
                            Reset password
                          </button>
                        )}
                        {!self && !u.disabledAt && (
                          <button
                            type="button"
                            className="text-fg-muted hover:text-fg"
                            data-testid={`user-signout-${u.username}`}
                            title="End this user's sessions on every browser and device"
                            onClick={() =>
                              void act(
                                () => call(`/api/users/${u.id}/sessions/revoke`, { method: "POST" }),
                                `${name} was signed out everywhere.`,
                              )
                            }
                          >
                            Sign out everywhere
                          </button>
                        )}
                        {!self && (
                          <button
                            type="button"
                            className="text-fg-muted hover:text-fg"
                            data-testid={`user-toggle-${u.username}`}
                            onClick={() =>
                              void act(
                                () => call(`/api/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ disabled: !u.disabledAt }) }),
                                `${name} ${u.disabledAt ? "enabled" : "disabled"}.`,
                              )
                            }
                          >
                            {u.disabledAt ? "Enable" : "Disable"}
                          </button>
                        )}
                        {!self &&
                          (confirmRemove === u.id ? (
                            <button
                              type="button"
                              className="font-medium text-danger"
                              data-testid={`user-remove-confirm-${u.username}`}
                              onClick={() => {
                                setConfirmRemove(null);
                                void act(() => call(`/api/users/${u.id}`, { method: "DELETE" }), `${name} removed.`);
                              }}
                            >
                              Confirm remove
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="text-fg-muted hover:text-danger"
                              data-testid={`user-remove-${u.username}`}
                              onClick={() => setConfirmRemove(u.id)}
                            >
                              Remove
                            </button>
                          ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

type AddMode = "entra" | "local";

function AddUser({ onDone }: { onDone: (n: Notice) => Promise<void> }) {
  const [mode, setMode] = useState<AddMode>("entra");
  const [role, setRole] = useState<Role>("viewer");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // From Entra ID
  const [picked, setPicked] = useState<EntraPerson | null>(null);
  const [sendEmail, setSendEmail] = useState(true);
  // With password (one-time password is emailed; never shown here)
  const [email, setEmail] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body =
      mode === "entra" ? { source: "entra", entraId: picked?.id, role, sendEmail } : { source: "local", email, role };
    const r = await call("/api/users", { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) {
      setError(r.message ?? "Could not add user");
      return;
    }
    const d = r.data as MailResult;
    if (mode === "local") {
      const to = email.trim().toLowerCase();
      await onDone(mailNotice(d, `Added ${to} and emailed them a one-time password.`, `Added ${to}`));
    } else if (!sendEmail) {
      await onDone({ tone: "ok", text: `Added ${picked?.displayName}. They can sign in with Microsoft.` });
    } else {
      await onDone(mailNotice(d, `Invitation sent to ${picked?.email}.`, `Added ${picked?.displayName}`));
    }
  }

  const canSubmit = mode === "entra" ? Boolean(picked) : /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email.trim());

  return (
    <form onSubmit={submit} data-testid="user-add-form" className="space-y-3 rounded-lg border border-border/60 bg-surface-2/30 p-3">
      <Segmented<AddMode>
        options={[
          { value: "entra", label: "From Entra ID" },
          { value: "local", label: "With password" },
        ]}
        value={mode}
        onChange={(m) => {
          setMode(m);
          setError(null);
        }}
        testIdPrefix="user-add-"
      />

      <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
        {mode === "entra" ? (
          <div>
            <Label>Person</Label>
            <EntraPersonPicker value={picked} onChange={setPicked} />
          </div>
        ) : (
          <div>
            <Label htmlFor="new-email">Email</Label>
            <Input
              id="new-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="dana@contoso.com"
            />
          </div>
        )}
        <div>
          <Label htmlFor="new-role">Role</Label>
          <Select id="new-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="primary" disabled={busy || !canSubmit} data-testid="user-add-submit">
          {busy ? "Adding…" : mode === "entra" ? (sendEmail ? "Invite" : "Add") : "Add & email password"}
        </Button>
      </div>

      {mode === "entra" ? (
        <label className="flex items-center gap-2 text-xs text-fg">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
            checked={sendEmail}
            onChange={(e) => setSendEmail(e.target.checked)}
            data-testid="user-add-send-email"
          />
          Email them an invitation to sign in with Microsoft
        </label>
      ) : (
        <p className="text-[11px] text-fg-muted">
          Argus emails them a one-time password. It works for one sign-in, then they must choose their own.
        </p>
      )}
      <p className="text-[11px] text-fg-muted" data-testid="user-add-role-hint">
        {ROLE_LABEL[role]}: {ROLE_DESCRIPTION[role]}
      </p>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

interface EntraPerson {
  id: string;
  displayName: string;
  email: string;
}

/** Search people in Entra ID and pick one. */
function EntraPersonPicker({ value, onChange }: { value: EntraPerson | null; onChange: (p: EntraPerson | null) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<EntraPerson[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The query the shown results belong to; while it differs from q we are searching.
  const [doneFor, setDoneFor] = useState("");

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const t = setTimeout(() => {
      void fetch(`/api/directory?kind=users&q=${encodeURIComponent(q.trim())}`)
        .then((r) => r.json())
        .then((b) => {
          if (b.success) {
            setError(null);
            setResults(b.data as EntraPerson[]);
          } else {
            setError(b.error?.message ?? "Search failed");
          }
        })
        .catch(() => setError("Search failed"))
        .finally(() => setDoneFor(term));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  if (value) {
    return (
      <div
        className="flex h-9 items-center justify-between rounded-md border border-border/60 bg-surface px-3 text-sm"
        data-testid="entra-person-picked"
      >
        <span className="truncate">
          <span className="text-fg">{value.displayName}</span>
          <span className="ml-2 text-xs text-fg-muted">{value.email}</span>
        </span>
        <button type="button" className="text-xs text-fg-muted hover:text-fg" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email…" data-testid="entra-person-search" />
      {q.trim().length >= 2 && (
        <ul
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border/70 bg-surface py-1 shadow-lg"
          data-testid="entra-person-results"
        >
          {doneFor !== q.trim() ? (
            <li className="px-3 py-1.5 text-xs text-fg-muted">Searching Entra ID…</li>
          ) : error ? (
            <li className="px-3 py-1.5 text-xs text-danger">{error}</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-1.5 text-xs text-fg-muted">No one in Entra ID matches “{q.trim()}”.</li>
          ) : (
            results.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="w-full px-3 py-1.5 text-left hover:bg-surface-2"
                  onClick={() => {
                    onChange(p);
                    setQ("");
                    setResults([]);
                  }}
                >
                  <span className="text-sm text-fg">{p.displayName}</span>
                  <span className="ml-2 text-xs text-fg-muted">{p.email}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
