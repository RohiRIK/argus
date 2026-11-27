"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { safeNextPath } from "@/lib/auth/access";
import { ArgusMark } from "@/components/icons";
import { Button, Card, CardContent, Input, Label } from "@/components/ui/primitives";
import { useCurrentUser } from "@/lib/use-current-user";

const MIN = 10;

/**
 * The one password form in Argus. After signing in with a one-time password the user
 * lands here (the proxy allows nothing else) and must choose their own; everyone else
 * reaches it from My account to change theirs.
 */
export function ChangePasswordForm() {
  const params = useSearchParams();
  const me = useCurrentUser();
  const forced = me?.mustChangePassword ?? false;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError("The new passwords don't match");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const b = await res.json();
      if (!b.success) {
        const field = b.error?.fields ? (Object.values(b.error.fields)[0] as string) : undefined;
        setError(field ?? b.error?.message ?? "Could not change the password");
        return;
      }
      window.location.assign(forced ? safeNextPath(params.get("next")) : "/account?password=changed");
    } catch {
      setError("Could not reach Argus");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardContent className="p-6">
        <div className="mb-6 flex items-center gap-3">
          <ArgusMark className="h-8 w-8 shrink-0" />
          <div>
            <h1 className="text-base font-semibold leading-none text-fg">{forced ? "Set your password" : "Change password"}</h1>
            <p className="mt-1.5 text-xs text-fg-muted">
              {forced
                ? "You signed in with a one-time password. Choose your own to continue."
                : `Signed in as ${me?.username ?? "…"}`}
            </p>
          </div>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4" data-testid="change-password-form">
          <div>
            <Label htmlFor="current-password">{forced ? "One-time password" : "Current password"}</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              autoFocus
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
              minLength={MIN}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              aria-describedby="new-password-hint"
            />
            <p id="new-password-hint" className="mt-1.5 text-xs text-fg-muted">
              At least {MIN} characters.
            </p>
          </div>
          <div>
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" id="change-password-error" className="text-xs text-danger">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={busy || !current || next.length < MIN || !confirm}>
            {busy ? "Saving…" : forced ? "Set password and continue" : "Change password"}
          </Button>
          <div className="flex justify-between text-[11px] text-fg-muted">
            {forced ? (
              <button
                type="button"
                className="hover:text-fg"
                onClick={() => void fetch("/api/auth/logout", { method: "POST" }).finally(() => window.location.assign("/login"))}
              >
                Sign out
              </button>
            ) : (
              <Link href="/account" className="hover:text-fg">
                ← Back to My account
              </Link>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
