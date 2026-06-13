"use client";

import { useEffect, useState } from "react";
import { IconAlert, IconEye, IconEyeOff, IconKey } from "@/components/icons";
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Label } from "@/components/ui/primitives";

interface VaultState {
  masterKeyPresent: boolean;
  configured: boolean;
  entries: { key: string; masked: string }[];
}

const FIELDS = [
  { key: "tenantId", label: "Entra ID Tenant ID", secret: false },
  { key: "clientId", label: "Entra ID Client ID", secret: false },
  { key: "clientSecret", label: "Entra ID Client Secret", secret: true },
  { key: "mailbox", label: "Shared Mailbox Email", secret: false },
];

export default function SettingsPage() {
  const [vault, setVault] = useState<VaultState | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const res = await fetch("/api/vault");
    const body = await res.json();
    if (body.success) setVault(body.data);
  }
  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setSaving(true);
    setMessage(null);
    const updates = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ""));
    const res = await fetch("/api/vault", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(updates),
    });
    const body = await res.json();
    setMessage(body.success ? "Saved — encrypted at rest." : `Error: ${body.error?.message}`);
    setValues({});
    await load();
    setSaving(false);
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/vault/test", { method: "POST" });
      const body = await res.json();
      const r = body.data;
      if (!body.success) setTestResult({ ok: false, text: body.error?.message });
      else if (r.ok) setTestResult({ ok: true, text: `Auth OK (${r.steps.auth.latencyMs} ms). ${r.steps.mailbox.note ?? ""}` });
      else setTestResult({ ok: false, text: `${r.steps.auth.ok ? "Mailbox" : "Auth"} failed: ${r.steps.auth.error ?? r.steps.mailbox.note}` });
    } catch (err) {
      setTestResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-5">
        {vault && !vault.masterKeyPresent && (
          <div className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm">
            <IconAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
            <div>
              <strong>ARGUS_MASTER_KEY is not set.</strong>
              <p className="mt-0.5 text-fg-muted">Generate a 32-byte key with <code className="font-mono">openssl rand -hex 32</code> and provide it to the container before storing credentials.</p>
            </div>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><IconKey className="h-4 w-4" /> Encrypted Vault</CardTitle>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${vault?.configured ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
              {vault?.configured ? "Configured" : "Incomplete"}
            </span>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-fg-muted">Credentials are AES-256-GCM encrypted at rest. The master key lives only in process memory and is never persisted or logged.</p>
            {FIELDS.map((f) => {
              const current = vault?.entries.find((e) => e.key === f.key);
              return (
                <div key={f.key}>
                  <Label>
                    {f.label}
                    {current && <span className="ml-2 font-mono opacity-50">stored: {current.masked}</span>}
                  </Label>
                  <div className="relative">
                    <Input
                      type={f.secret && !showSecret ? "password" : "text"}
                      value={values[f.key] ?? ""}
                      placeholder={current ? "•••••• (unchanged)" : ""}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      disabled={!vault?.masterKeyPresent}
                    />
                    {f.secret && (
                      <button
                        type="button"
                        onClick={() => setShowSecret((s) => !s)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg"
                      >
                        {showSecret ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button onClick={save} disabled={saving || !vault?.masterKeyPresent}>
                {saving ? "Saving…" : "Save credentials"}
              </Button>
              <Button variant="outline" onClick={testConnection} disabled={testing || !vault?.masterKeyPresent}>
                {testing ? "Testing…" : "Test Connection"}
              </Button>
              {message && <span className="text-xs text-fg-muted">{message}</span>}
            </div>
            {testResult && (
              <p className={`text-xs ${testResult.ok ? "text-success" : "text-danger"}`}>
                {testResult.ok ? "✓ " : "✕ "}{testResult.text}
              </p>
            )}
          </CardContent>
        </Card>
    </div>
  );
}
