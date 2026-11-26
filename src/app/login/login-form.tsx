"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { safeNextPath } from "@/lib/auth/access";
import { ArgusMark } from "@/components/icons";
import { Button, Card, CardContent, Input, Label } from "@/components/ui/primitives";

type Mode = "loading" | "login" | "setup" | "setup-closed";

interface ApiBody {
  success: boolean;
  data?: { needsSetup?: boolean; setupOpen?: boolean; minPasswordLength?: number };
  error?: { message?: string; fields?: Record<string, string> };
}

export function LoginForm() {
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>("loading");
  const [minLen, setMinLen] = useState(10);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  // Errors from the Microsoft sign-in callback arrive as ?error=…
  const [error, setError] = useState<string | null>(params.get("error"));
  const [busy, setBusy] = useState(false);
  const [microsoft, setMicrosoft] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/setup")
      .then((r) => r.json() as Promise<ApiBody>)
      .then((b) => {
        if (b.data?.minPasswordLength) setMinLen(b.data.minPasswordLength);
        setMode(!b.data?.needsSetup ? "login" : b.data.setupOpen ? "setup" : "setup-closed");
      })
      .catch(() => setMode("login"));
    void fetch("/api/auth/providers")
      .then((r) => r.json())
      .then((b) => setMicrosoft(Boolean(b.data?.microsoft)))
      .catch(() => undefined);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "setup" && password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(mode === "setup" ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = (await res.json()) as ApiBody;
      if (!res.ok || !body.success) {
        const field = body.error?.fields ? Object.values(body.error.fields)[0] : undefined;
        setError(field ?? body.error?.message ?? "Sign-in failed");
        return;
      }
      window.location.assign(safeNextPath(params.get("next")));
    } catch {
      setError("Could not reach Argus");
    } finally {
      setBusy(false);
    }
  }

  const isSetup = mode === "setup";
  const title = isSetup ? "Create the admin account" : "Sign in to Argus";
  const subtitle = isSetup
    ? "First run: choose the username and password you will sign in with."
    : mode === "setup-closed"
      ? "No account exists yet."
      : microsoft
        ? "Use your Microsoft 365 account, or an Argus account."
        : "Enter your username and password.";

  return (
    <Card className="w-full max-w-sm">
      <CardContent className="p-6">
        <div className="mb-6 flex items-center gap-3">
          <ArgusMark className="h-8 w-8 shrink-0" />
          <div>
            <h1 className="text-base font-semibold leading-none text-fg">{title}</h1>
            <p className="mt-1.5 text-xs text-fg-muted">{subtitle}</p>
          </div>
        </div>

        {mode === "setup-closed" ? (
          <div className="space-y-2 text-xs text-fg-muted" data-testid="setup-closed">
            <p>For safety, the first account can only be created within 30 minutes of Argus starting.</p>
            <p>
              Restart Argus and reload this page, or create the account on the host:{" "}
              <code className="font-mono text-fg">docker exec argus bun run auth:reset-password admin</code>
            </p>
          </div>
        ) : (
          <>
          {microsoft && !isSetup && (
            <div className="mb-5 space-y-4">
              <a
                href={`/api/auth/microsoft/start?next=${encodeURIComponent(safeNextPath(params.get("next")))}`}
                data-testid="sign-in-microsoft"
                className="flex h-10 w-full items-center justify-center gap-2.5 rounded-md border border-border bg-surface text-sm font-medium text-fg transition-colors hover:bg-surface-2"
              >
                <svg aria-hidden viewBox="0 0 21 21" className="h-4 w-4">
                  <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                  <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                  <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                  <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
                </svg>
                Sign in with Microsoft
              </a>
              <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-fg-muted">
                <span className="h-px flex-1 bg-border" />
                or with an Argus account
                <span className="h-px flex-1 bg-border" />
              </div>
            </div>
          )}
          <form onSubmit={submit} className="flex flex-col gap-4" data-testid="login-form">
            <div>
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                autoFocus
                required
                disabled={mode === "loading"}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={isSetup ? "new-password" : "current-password"}
                required
                minLength={isSetup ? minLen : undefined}
                disabled={mode === "loading"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby={isSetup ? "password-hint" : undefined}
              />
              {isSetup && (
                <p id="password-hint" className="mt-1.5 text-xs text-fg-muted">
                  At least {minLen} characters.
                </p>
              )}
            </div>
            {isSetup && (
              <div>
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
            )}
            {error && (
              <p id="login-error" role="alert" className="text-xs text-danger">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy || mode === "loading" || !username || !password}>
              {busy ? (isSetup ? "Creating…" : "Signing in…") : isSetup ? "Create account" : "Sign in"}
            </Button>
            {!isSetup && mode === "login" && (
              <p className="text-[11px] text-fg-muted">
                Forgot your password? On the host run{" "}
                <code className="font-mono">docker exec argus bun run auth:reset-password &lt;username&gt;</code>.
              </p>
            )}
          </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}
