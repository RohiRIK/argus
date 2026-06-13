"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

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
    setMessage(body.success ? "Saved (encrypted)." : `Error: ${body.error?.message}`);
    setValues({});
    await load();
    setSaving(false);
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-xs underline underline-offset-4">
            Dashboard
          </Link>
          <ThemeToggle />
        </div>
      </header>

      {vault && !vault.masterKeyPresent && (
        <div className="mb-6 rounded-md border border-status-failed/40 bg-status-failed/10 p-3 text-sm">
          <strong>ARGUS_MASTER_KEY is not set.</strong> Generate a 32-byte key
          (<code>openssl rand -hex 32</code>) and provide it to the container before storing credentials.
        </div>
      )}

      <section className="rounded-lg border border-[hsl(var(--border))] p-5">
        <h2 className="mb-1 font-medium">Encrypted Vault</h2>
        <p className="mb-4 text-xs opacity-60">
          Credentials are AES-256-GCM encrypted at rest. Status:{" "}
          {vault?.configured ? "✓ configured" : "incomplete"}.
        </p>

        <div className="space-y-3">
          {FIELDS.map((f) => {
            const current = vault?.entries.find((e) => e.key === f.key);
            return (
              <div key={f.key}>
                <label className="mb-1 block text-xs font-medium" htmlFor={f.key}>
                  {f.label}
                  {current && <span className="ml-2 opacity-50">stored: {current.masked}</span>}
                </label>
                <input
                  id={f.key}
                  type={f.secret && !showSecret ? "password" : "text"}
                  value={values[f.key] ?? ""}
                  placeholder={current ? "•••••• (unchanged)" : ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm"
                  disabled={!vault?.masterKeyPresent}
                />
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving || !vault?.masterKeyPresent}
            className="rounded-md bg-status-suppressed px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save credentials"}
          </button>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={showSecret} onChange={(e) => setShowSecret(e.target.checked)} />
            Show secret
          </label>
          {message && <span className="text-xs opacity-70">{message}</span>}
        </div>
      </section>
    </main>
  );
}
