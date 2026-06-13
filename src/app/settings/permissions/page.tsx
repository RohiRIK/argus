"use client";

import { useEffect, useState, useCallback } from "react";
import { ShieldCheck, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Button } from "@/components/ui/primitives";

const TONE: Record<string, string> = {
  ok: "bg-success/10 text-success",
  missing: "bg-warning/10 text-warning",
  error: "bg-danger/10 text-danger",
};

export default function PermissionsPage() {
  const [status, setStatus] = useState<string>("…");
  const [lastCheck, setLastCheck] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/permissions");
    const body = await res.json();
    if (body.success) {
      setStatus(body.data.status);
      setLastCheck(body.data.lastCheck);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function revalidate() {
    setBusy(true);
    await fetch("/api/settings/permissions/remediate", { method: "POST" });
    await load();
    setBusy(false);
  }

  return (
    <div className="space-y-4" data-testid="permissions-panel">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Mailbox Permissions</CardTitle>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[status] ?? "bg-surface-2"}`}>{status}</span>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-fg-muted">
            Argus validates that the app can send only from the scoped shared mailbox. When permissions are
            missing it enters read-only mode (reports render, email is skipped). Apply the Exchange RBAC scope,
            then re-validate.
          </p>
          <dl className="grid grid-cols-2 gap-1 text-xs">
            <dt className="text-fg-muted">Status</dt>
            <dd className="text-right font-medium">{status}</dd>
            <dt className="text-fg-muted">Last checked</dt>
            <dd className="text-right">{lastCheck ? new Date(lastCheck).toLocaleString() : "never"}</dd>
          </dl>
          <Button variant="outline" onClick={revalidate} disabled={busy}>
            <RefreshCw className="h-3.5 w-3.5" /> {busy ? "Re-validating…" : "Re-validate"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
