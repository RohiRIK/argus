"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@/components/ui/primitives";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

interface GroupRef {
  id: string;
  name: string;
}

interface SignInView {
  config: { enabled: boolean; groups: Partial<Record<Role, GroupRef>> };
  enabled: boolean;
  available: boolean;
  reason?: string;
  redirectUri: string;
}

/** Users page: "Sign in with Microsoft" and the Entra group behind each role. */
export function EntraSignInCard() {
  const [view, setView] = useState<SignInView | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [groups, setGroups] = useState<Partial<Record<Role, GroupRef>>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/users/sign-in")
      .then((r) => r.json())
      .then((b) => {
        if (!b.success) return;
        const v = b.data as SignInView;
        setView(v);
        setEnabled(v.config.enabled);
        setGroups(v.config.groups);
      })
      .catch(() => undefined);
  }, []);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/users/sign-in", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, groups: { admin: groups.admin ?? null, operator: groups.operator ?? null, viewer: groups.viewer ?? null } }),
      });
      const b = await res.json();
      if (!b.success) {
        setMsg({ ok: false, text: b.error?.message ?? "Could not save" });
        return;
      }
      setView(b.data as SignInView);
      setMsg({ ok: true, text: "Saved." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="entra-sign-in-card">
      <CardHeader>
        <div>
        <CardTitle>Sign in with Microsoft</CardTitle>
        <p className="mt-1 text-xs text-fg-muted">
          People sign in with their Microsoft 365 account. Their role comes from the Entra group you pick below and is
          checked at every sign-in; the highest matching role wins. People in none of these groups can&apos;t sign in.
          Password accounts keep working as a fallback.
        </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[hsl(var(--primary))]"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            data-testid="entra-sign-in-enabled"
          />
          Allow Microsoft sign-in
        </label>

        <div className="space-y-2">
          {ROLES.map((r) => (
            <div key={r} className="grid items-center gap-2 sm:grid-cols-[100px_1fr]">
              <span className="text-xs font-medium text-fg">{ROLE_LABEL[r]}s</span>
              <GroupPicker
                role={r}
                value={groups[r] ?? null}
                onChange={(g) => setGroups((cur) => ({ ...cur, [r]: g ?? undefined }))}
              />
            </div>
          ))}
        </div>

        {view && (
          <div
            className={cn(
              "rounded-lg border px-3 py-2 text-xs",
              view.available ? "border-success/30 bg-success/5" : "border-border/60 bg-surface-2/40",
            )}
            data-testid="entra-sign-in-status"
          >
            {view.available ? (
              <span className="font-medium text-success">Live — the sign-in page shows “Sign in with Microsoft”.</span>
            ) : (
              <span className="text-fg-muted">{view.reason}</span>
            )}
            <p className="mt-1 text-fg-muted">
              Sign-in callback: <code className="select-all font-mono text-fg">{view.redirectUri}</code>. Argus adds it to
              its app registration when you click <span className="font-medium">Authorize</span> in{" "}
              <Link href="/settings/integrations" className="text-primary hover:underline">
                Settings → Integrations
              </Link>
              .
            </p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button variant="primary" size="sm" onClick={() => void save()} disabled={busy} data-testid="entra-sign-in-save">
            {busy ? "Saving…" : "Save"}
          </Button>
          {msg && <span className={cn("text-xs", msg.ok ? "text-success" : "text-danger")}>{msg.text}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

/** Search Entra security groups and pick one (or clear). */
function GroupPicker({
  role,
  value,
  onChange,
}: {
  role: Role;
  value: GroupRef | null;
  onChange: (g: GroupRef | null) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GroupRef[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => {
      void fetch(`/api/directory?kind=groups&q=${encodeURIComponent(q.trim())}`)
        .then((r) => r.json())
        .then((b) => {
          if (b.success) {
            setError(null);
            setResults((b.data as Array<{ id: string; displayName: string }>).map((g) => ({ id: g.id, name: g.displayName })));
          } else {
            setError(b.error?.message ?? "Search failed");
          }
        })
        .catch(() => setError("Search failed"));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-1.5 text-sm" data-testid={`entra-group-${role}`}>
        <span className="truncate text-fg">{value.name}</span>
        <button type="button" className="text-xs text-fg-muted hover:text-fg" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search Entra groups…"
        className="h-8 text-xs"
        data-testid={`entra-group-search-${role}`}
      />
      {q.trim().length >= 2 && (results.length > 0 || error) && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border/70 bg-surface py-1 shadow-lg">
          {error ? (
            <li className="px-3 py-1.5 text-xs text-danger">{error}</li>
          ) : (
            results.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  className="w-full px-3 py-1.5 text-left text-xs text-fg hover:bg-surface-2"
                  onClick={() => {
                    onChange(g);
                    setQ("");
                    setResults([]);
                  }}
                >
                  {g.name}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
