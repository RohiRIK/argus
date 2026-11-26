"use client";

import { useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@/components/ui/primitives";
import { ROLE_DESCRIPTION, ROLE_LABEL } from "@/lib/auth/roles";
import { useCurrentUser } from "@/lib/use-current-user";

/** Settings → My account: who is signed in, their role, and (local accounts) password change. */
export function AccountCard() {
  const me = useCurrentUser();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function change(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const b = await res.json();
      if (!b.success) {
        const field = b.error?.fields ? (Object.values(b.error.fields)[0] as string) : undefined;
        setMsg({ ok: false, text: field ?? b.error?.message ?? "Could not change password" });
        return;
      }
      setCurrent("");
      setNext("");
      setMsg({ ok: true, text: "Password changed." });
    } finally {
      setBusy(false);
    }
  }

  const machine = me?.username === "api-key" || me?.username === "anonymous";
  const canChange = me && me.username && !machine && me.authSource === "local";

  return (
    <div className="space-y-4">
      <Card data-testid="account-card">
        <CardHeader>
          <CardTitle>My account</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[140px_1fr]">
            <dt className="text-fg-muted">Signed in as</dt>
            <dd className="text-fg">
              {me?.displayName && <span className="mr-2 font-medium">{me.displayName}</span>}
              <span className="font-mono text-xs text-fg-muted">{me?.username ?? "…"}</span>
            </dd>
            <dt className="text-fg-muted">Role</dt>
            <dd className="text-fg" data-testid="account-role">
              {me ? (
                <>
                  <span className="font-medium">{ROLE_LABEL[me.role]}</span>
                  <span className="ml-2 text-xs text-fg-muted">{ROLE_DESCRIPTION[me.role]}</span>
                </>
              ) : (
                "…"
              )}
            </dd>
            <dt className="text-fg-muted">Signs in with</dt>
            <dd className="text-fg">
              {machine ? "Access key" : me?.authSource === "entra" ? "Microsoft (Entra ID)" : "Argus password"}
            </dd>
          </dl>
          {me?.authSource === "entra" && (
            <p className="mt-4 text-xs text-fg-muted">
              Your role comes from your Entra group membership and is refreshed every time you sign in.
            </p>
          )}
        </CardContent>
      </Card>

      {canChange && (
        <Card data-testid="password-card">
          <CardHeader>
            <CardTitle>Change password</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={change} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div>
                <Label htmlFor="current-password">Current password</Label>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={busy || !current || next.length < 10}>
                {busy ? "Saving…" : "Change password"}
              </Button>
            </form>
            {msg && (
              <p role="status" className={`mt-2 text-xs ${msg.ok ? "text-success" : "text-danger"}`}>
                {msg.text}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
