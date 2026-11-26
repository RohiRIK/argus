"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { safeNextPath } from "@/lib/auth/access";
import { ArgusMark } from "@/components/icons";
import { Button, Card, CardContent, Input, Label } from "@/components/ui/primitives";

export function LoginForm() {
  const params = useSearchParams();
  const [accessKey, setAccessKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessKey }),
      });
      const body = (await res.json()) as { success: boolean; error?: { message?: string } };
      if (!res.ok || !body.success) {
        setError(body.error?.message ?? "Sign-in failed");
        return;
      }
      window.location.assign(safeNextPath(params.get("next")));
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
            <h1 className="text-base font-semibold leading-none text-fg">Sign in to Argus</h1>
            <p className="mt-1.5 text-xs text-fg-muted">Enter the operator access key.</p>
          </div>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4" data-testid="login-form">
          <div>
            <Label htmlFor="access-key">Access key</Label>
            <Input
              id="access-key"
              name="accessKey"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "login-error" : "login-hint"}
            />
            {error ? (
              <p id="login-error" role="alert" className="mt-1.5 text-xs text-danger">
                {error}
              </p>
            ) : (
              <p id="login-hint" className="mt-1.5 text-xs text-fg-muted">
                On the Argus host run <code className="font-mono">bun run auth:access-key</code>, or{" "}
                <code className="font-mono">docker exec argus bun run auth:access-key</code>.
              </p>
            )}
          </div>
          <Button type="submit" disabled={busy || accessKey.length === 0}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
