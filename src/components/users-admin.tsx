"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select } from "@/components/ui/primitives";
import { RelativeTime } from "@/components/ui/relative-time";
import { EntraSignInCard } from "@/components/entra-sign-in-card";
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
}

type Notice = { ok: boolean; text: string; secret?: string } | null;

/** A readable temporary password (shown once to the admin who set it). */
function tempPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

async function call(url: string, init?: RequestInit): Promise<{ ok: boolean; data?: unknown; message?: string }> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const b = await res.json().catch(() => ({}));
  if (b.success) return { ok: true, data: b.data };
  const field = b.error?.fields ? (Object.values(b.error.fields)[0] as string) : undefined;
  return { ok: false, message: field ?? b.error?.message ?? `Request failed (${res.status})` };
}

/** Settings → Users & roles (admin): accounts, roles, and Microsoft sign-in. */
export function UsersAdmin() {
  const me = useCurrentUser();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [adding, setAdding] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await call("/api/users");
    if (r.ok) setUsers(r.data as UserRow[]);
    else setNotice({ ok: false, text: r.message ?? "Could not load users" });
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

  async function act(fn: () => Promise<{ ok: boolean; message?: string }>, success: string, secret?: string) {
    const r = await fn();
    setNotice(r.ok ? { ok: true, text: success, secret } : { ok: false, text: r.message ?? "Failed" });
    if (r.ok) await load();
  }

  return (
    <div className="space-y-4" data-testid="users-admin">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Users</CardTitle>
            <dl className="mt-2 grid grid-cols-[72px_1fr] gap-x-3 gap-y-0.5 text-xs">
              {ROLES.map((r) => (
                <div key={r} className="contents">
                  <dt className="font-medium text-fg">{ROLE_LABEL[r]}</dt>
                  <dd className="text-fg-muted">{ROLE_DESCRIPTION[r]}</dd>
                </div>
              ))}
            </dl>
          </div>
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
            <AddUserForm
              onDone={async (username, password) => {
                setAdding(false);
                setNotice({ ok: true, text: `Added ${username}. Share this temporary password with them:`, secret: password });
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
                notice.ok ? "border-success/30 bg-success/5 text-fg" : "border-danger/30 bg-danger/5 text-danger",
              )}
            >
              {notice.text}
              {notice.secret && (
                <code className="ml-2 select-all rounded bg-surface-2 px-1.5 py-0.5 font-mono text-fg" data-testid="temp-password">
                  {notice.secret}
                </code>
              )}
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-border/60">
            <table className="w-full text-sm" data-testid="users-table">
              <thead className="bg-surface-2/50 text-left text-[11px] uppercase tracking-wider text-fg-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">User</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Last sign-in</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {(users ?? []).map((u) => {
                  const self = u.username === me.username;
                  return (
                    <tr key={u.id} data-testid={`user-row-${u.username}`} className={u.disabledAt ? "opacity-60" : undefined}>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-fg">
                          {u.displayName ?? u.username}
                          {self && <span className="ml-2 text-[11px] font-normal text-fg-muted">(you)</span>}
                        </div>
                        <div className="text-[11px] text-fg-muted">
                          {u.displayName ? `${u.username} · ` : ""}
                          {u.authSource === "entra" ? "Microsoft" : "Password"}
                          {u.disabledAt && <span className="ml-1 font-medium text-warning">· Disabled</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {u.authSource === "entra" ? (
                          <span title="Set by Entra group membership at each sign-in">
                            {ROLE_LABEL[u.role]} <span className="text-[11px] text-fg-muted">· from group</span>
                          </span>
                        ) : (
                          <Select
                            aria-label={`Role for ${u.username}`}
                            data-testid={`user-role-${u.username}`}
                            value={u.role}
                            onChange={(e) =>
                              void act(
                                () => call(`/api/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ role: e.target.value }) }),
                                `${u.username} is now ${ROLE_LABEL[e.target.value as Role]}.`,
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
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-fg-muted">
                        {u.lastLoginAt ? <RelativeTime iso={u.lastLoginAt} /> : "Never"}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-3 text-xs">
                          {u.authSource === "local" && (
                            <button
                              type="button"
                              className="text-fg-muted hover:text-fg"
                              data-testid={`user-reset-${u.username}`}
                              onClick={() => {
                                const pw = tempPassword();
                                void act(
                                  () => call(`/api/users/${u.id}/password`, { method: "POST", body: JSON.stringify({ password: pw }) }),
                                  `New temporary password for ${u.username}:`,
                                  pw,
                                );
                              }}
                            >
                              Reset password
                            </button>
                          )}
                          {!self && (
                            <button
                              type="button"
                              className="text-fg-muted hover:text-fg"
                              data-testid={`user-toggle-${u.username}`}
                              onClick={() =>
                                void act(
                                  () =>
                                    call(`/api/users/${u.id}`, {
                                      method: "PATCH",
                                      body: JSON.stringify({ disabled: !u.disabledAt }),
                                    }),
                                  `${u.username} ${u.disabledAt ? "enabled" : "disabled"}.`,
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
                                  void act(() => call(`/api/users/${u.id}`, { method: "DELETE" }), `${u.username} removed.`);
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

      <EntraSignInCard />
    </div>
  );
}

function AddUserForm({ onDone }: { onDone: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [password] = useState(tempPassword);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await call("/api/users", { method: "POST", body: JSON.stringify({ username, password, role }) });
    setBusy(false);
    if (!r.ok) {
      setError(r.message ?? "Could not add user");
      return;
    }
    await onDone(username.trim().toLowerCase(), password);
  }

  return (
    <form
      onSubmit={submit}
      data-testid="user-add-form"
      className="grid gap-3 rounded-lg border border-border/60 bg-surface-2/30 p-3 sm:grid-cols-[1fr_160px_auto] sm:items-end"
    >
      <div>
        <Label htmlFor="new-username">Username</Label>
        <Input id="new-username" required value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. dana" />
      </div>
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
      <Button type="submit" variant="primary" disabled={busy || username.trim().length < 3}>
        {busy ? "Adding…" : "Add"}
      </Button>
      <p className="text-[11px] text-fg-muted sm:col-span-3">
        Argus creates a temporary password and shows it once. The user changes it under Settings → My account.
      </p>
      {error && (
        <p role="alert" className="text-xs text-danger sm:col-span-3">
          {error}
        </p>
      )}
    </form>
  );
}
