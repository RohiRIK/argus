"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { ROLE_DESCRIPTION, ROLE_LABEL } from "@/lib/auth/roles";
import { useCurrentUser } from "@/lib/use-current-user";

/** My account (/account): who is signed in, their role, and how they sign in. */
export function AccountCard() {
  const me = useCurrentUser();
  const params = useSearchParams();
  const machine = me?.username === "api-key" || me?.username === "anonymous";
  const hasPassword = Boolean(me?.username) && !machine && me?.authSource === "local";
  const canSignOutOthers = Boolean(me?.username) && !machine;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function signOutOthers() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/sessions/revoke", { method: "POST" });
      const b = await res.json().catch(() => null);
      setMsg(
        b?.success
          ? { ok: true, text: "Signed out of every other browser and device. You stay signed in here." }
          : { ok: false, text: b?.error?.message ?? "Could not sign out other sessions" },
      );
    } catch {
      setMsg({ ok: false, text: "Could not sign out other sessions" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="account-card">
      <CardHeader>
        <CardTitle>My account</CardTitle>
      </CardHeader>
      <CardContent>
        {params.get("password") === "changed" && (
          <p role="status" className="mb-4 rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-xs text-success">
            Your password was changed. Any other browsers and devices signed in as you were signed out.
          </p>
        )}
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
            {hasPassword && (
              <Link href="/change-password" className="ml-3 text-xs font-medium text-primary hover:underline" data-testid="change-password-link">
                Change password
              </Link>
            )}
          </dd>
          {canSignOutOthers && (
            <>
              <dt className="text-fg-muted">Sessions</dt>
              <dd className="text-fg">
                <Button size="sm" variant="secondary" onClick={signOutOthers} disabled={busy} data-testid="sign-out-others">
                  {busy ? "Signing out…" : "Sign out other sessions"}
                </Button>
                <span className="mt-1 block text-xs text-fg-muted">
                  Ends your sessions on every other browser and device. Changing your password does this too.
                </span>
                {msg && (
                  <span role="status" className={`mt-1 block text-xs ${msg.ok ? "text-success" : "text-danger"}`} data-testid="sign-out-others-status">
                    {msg.text}
                  </span>
                )}
              </dd>
            </>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}
