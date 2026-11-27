"use client";

import { useEffect, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@/components/ui/primitives";

/** Settings → Account: who is signed in, and change your password. */
export function AccountCard() {
  const [username, setUsername] = useState<string | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/me")
      .then((r) => r.json())
      .then((b) => b.success && setUsername(b.data.username))
      .catch(() => undefined);
  }, []);

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

  const canChange = username && username !== "api-key" && username !== "anonymous";

  return (
    <Card data-testid="account-card">
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <p className="mt-1 text-xs text-fg-muted">
          Signed in as <span className="font-mono text-fg">{username ?? "…"}</span>
        </p>
      </CardHeader>
      {canChange && (
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
      )}
    </Card>
  );
}
