"use client";

import { useEffect, useState, useCallback } from "react";
import { IconPlug, IconTrash, IconSend, IconPlus, IconCloud } from "@/components/icons";
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Label } from "@/components/ui/primitives";

interface Webhook {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  lastDeliveryStatus: string | null;
}

const PROVIDER = "microsoft365";
const PLACEHOLDERS = [
  { name: "Google Cloud Platform", desc: "GCP audit & IAM reports" },
  { name: "Amazon Web Services", desc: "CloudTrail & IAM reports" },
  { name: "Custom Webhook", desc: "Generic outbound connector" },
];

export default function IntegrationsPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/integrations/${PROVIDER}/webhooks`);
    const body = await res.json();
    if (body.success) setWebhooks(body.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (!url.trim()) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/integrations/${PROVIDER}/webhooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name || "Webhook", url }),
    });
    const body = await res.json();
    if (body.success) {
      setName("");
      setUrl("");
      await load();
    } else setMsg(body.error?.message ?? "failed");
    setBusy(false);
  }

  async function remove(id: string) {
    await fetch(`/api/integrations/${PROVIDER}/webhooks/${id}`, { method: "DELETE" });
    await load();
  }
  async function test(id: string) {
    const res = await fetch(`/api/integrations/${PROVIDER}/webhooks/${id}/test`, { method: "POST" });
    const body = await res.json();
    setMsg(body.success ? `Test → ${body.data.status}` : `Test failed: ${body.error?.message}`);
    await load();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="integrations-panel">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><IconPlug className="h-4 w-4 text-primary" /> Microsoft 365</CardTitle>
          <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">Primary</span>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-fg-muted">Webhooks receive suppressed-execution notifications (with full report HTML). Each URL is retried 3× with backoff.</p>

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[140px]">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Slack" />
            </div>
            <div className="flex-[2] min-w-[200px]">
              <Label>Webhook URL</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.slack.com/…" />
            </div>
            <Button onClick={add} disabled={busy}><IconPlus className="h-3.5 w-3.5" /> Add</Button>
          </div>
          {msg && <p className="text-xs text-fg-muted">{msg}</p>}

          <div className="divide-y divide-border">
            {webhooks.length === 0 ? (
              <p className="py-4 text-xs text-fg-muted">No webhooks configured.</p>
            ) : (
              webhooks.map((w) => (
                <div key={w.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{w.name}</p>
                    <p className="truncate font-mono text-[11px] text-fg-muted">{w.url}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {w.lastDeliveryStatus && (
                      <span className={`text-[10px] ${w.lastDeliveryStatus === "success" ? "text-success" : "text-danger"}`}>
                        {w.lastDeliveryStatus}
                      </span>
                    )}
                    <Button variant="ghost" size="icon" title="Test" onClick={() => test(w.id)}><IconSend className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" title="Delete" onClick={() => remove(w.id)}><IconTrash className="h-3.5 w-3.5 text-danger" /></Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {PLACEHOLDERS.map((p) => (
        <Card key={p.name} className="opacity-70">
          <CardContent className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-2"><IconCloud className="h-4 w-4 text-fg-muted" /></div>
              <div>
                <p className="text-sm font-medium">{p.name}</p>
                <p className="text-xs text-fg-muted">{p.desc}</p>
              </div>
            </div>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-fg-muted">Coming soon</span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
