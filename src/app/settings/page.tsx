"use client";

import { useEffect, useState } from "react";
import { IconAlert } from "@/components/icons";
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Label, Segmented, Select } from "@/components/ui/primitives";

interface GeneralState {
  globalRecipients: string;
  adminContacts: string;
  language: "en" | "he";
  timezone: string;
  retentionDays: string;
  fromAddress: string;
  replyTo: string;
  appVersion: string;
  masterKeyPresent: boolean;
}

const EMPTY: GeneralState = {
  globalRecipients: "",
  adminContacts: "",
  language: "en",
  timezone: "UTC",
  retentionDays: "90",
  fromAddress: "",
  replyTo: "",
  appVersion: "—",
  masterKeyPresent: true,
};

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Jerusalem",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

function parseList(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

export default function GeneralSettingsPage() {
  const [state, setState] = useState<GeneralState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/settings")
      .then((r) => r.json())
      .then((b) => {
        if (!b.success) return;
        const d = b.data;
        setState({
          globalRecipients: (d.globalRecipients ?? []).join(", "),
          adminContacts: (d.adminContacts ?? []).join(", "),
          language: d.language ?? "en",
          timezone: d.timezone ?? "UTC",
          retentionDays: String(d.retentionDays ?? 90),
          fromAddress: d.fromAddress ?? "",
          replyTo: d.replyTo ?? "",
          appVersion: d.appVersion ?? "—",
          masterKeyPresent: d.masterKeyPresent ?? true,
        });
      })
      .finally(() => setLoaded(true));
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        globalRecipients: parseList(state.globalRecipients),
        adminContacts: parseList(state.adminContacts),
        language: state.language,
        timezone: state.timezone,
        retentionDays: Number(state.retentionDays) || 90,
        fromAddress: state.fromAddress.trim() || null,
        replyTo: state.replyTo.trim() || null,
      }),
    });
    const body = await res.json();
    setMsg(body.success ? "Saved." : `Error: ${body.error?.message ?? "failed"}`);
    setSaving(false);
  }

  async function doExport() {
    const res = await fetch("/api/backup");
    const body = await res.json();
    if (!body.success) {
      setMsg("Export failed.");
      return;
    }
    const blob = new Blob([JSON.stringify(body.data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `argus-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function doImport(file: File) {
    setMsg(null);
    const text = await file.text();
    const res = await fetch("/api/backup", { method: "POST", headers: { "content-type": "application/json" }, body: text });
    const body = await res.json();
    setMsg(
      body.success
        ? `Imported ${body.data.imported.jobs} job(s), ${body.data.imported.templates} template(s).`
        : `Import error: ${body.error?.message ?? "failed"}`,
    );
  }

  return (
    <div className="space-y-6" data-testid="general-panel">
      {/* Master key status (UX-F2) */}
      {loaded && !state.masterKeyPresent && (
        <div className="flex items-start gap-3.5 rounded-xl border border-danger/20 bg-danger/5 p-4 shadow-sm" data-testid="master-key-alert">
          <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-danger/10">
            <IconAlert className="h-4 w-4 text-danger" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-fg">ARGUS_MASTER_KEY is not set</p>
            <p className="text-xs text-fg-muted leading-relaxed">
              Generate a 32-byte key with <code className="font-mono text-danger/80">openssl rand -hex 32</code> and provide it to the container before storing credentials in Integrations.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted/60" data-testid="app-version">
            v{state.appVersion}
          </span>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <Label>Global default recipients <span className="text-fg-muted/50">(comma-separated)</span></Label>
            <Input
              value={state.globalRecipients}
              onChange={(e) => setState((s) => ({ ...s, globalRecipients: e.target.value }))}
              placeholder="reports@contoso.com"
              data-testid="global-recipients"
            />
            <p className="mt-1 text-[11px] text-fg-muted/60">Fallback when a job has no explicit recipients.</p>
          </div>

          <div>
            <Label>Admin contacts <span className="text-fg-muted/50">(comma-separated)</span></Label>
            <Input
              value={state.adminContacts}
              onChange={(e) => setState((s) => ({ ...s, adminContacts: e.target.value }))}
              placeholder="ops@contoso.com"
              data-testid="admin-contacts"
            />
            <p className="mt-1 text-[11px] text-fg-muted/60">Notified about system-level alerts such as connection failures.</p>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="mb-0">Language</Label>
              <p className="mt-1 text-[11px] text-fg-muted/60">Affects UI direction and date formatting.</p>
            </div>
            <Segmented<"en" | "he">
              value={state.language}
              onChange={(language) => setState((s) => ({ ...s, language }))}
              options={[{ value: "en", label: "EN" }, { value: "he", label: "HE" }]}
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label>Timezone</Label>
              <Select
                value={state.timezone}
                onChange={(e) => setState((s) => ({ ...s, timezone: e.target.value }))}
                data-testid="timezone"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
                ))}
              </Select>
              <p className="mt-1 text-[11px] text-fg-muted/60">Schedules fire and preview in this zone.</p>
            </div>
            <div>
              <Label>Data retention <span className="text-fg-muted/50">(days)</span></Label>
              <Input
                type="number"
                min={7}
                value={state.retentionDays}
                onChange={(e) => setState((s) => ({ ...s, retentionDays: e.target.value }))}
                data-testid="retention-days"
              />
              <p className="mt-1 text-[11px] text-fg-muted/60">Baseline history older than this is pruned (min 7).</p>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label>From address <span className="text-fg-muted/50">(optional)</span></Label>
              <Input
                type="email"
                value={state.fromAddress}
                onChange={(e) => setState((s) => ({ ...s, fromAddress: e.target.value }))}
                placeholder="defaults to the shared mailbox"
                data-testid="from-address"
              />
            </div>
            <div>
              <Label>Reply-To <span className="text-fg-muted/50">(optional)</span></Label>
              <Input
                type="email"
                value={state.replyTo}
                onChange={(e) => setState((s) => ({ ...s, replyTo: e.target.value }))}
                placeholder="noreply@contoso.com"
                data-testid="reply-to"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button variant="primary" onClick={save} disabled={saving || !loaded} data-testid="save-general">
              {saving ? "Saving…" : "Save"}
            </Button>
            {msg && <span className="text-xs text-fg-muted">{msg}</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Backup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-fg-muted/80 leading-relaxed">
            Export jobs, templates, and non-secret settings as JSON. Credentials and the master key are never included. Import upserts and re-schedules.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={doExport} data-testid="export-backup">Export</Button>
            <label className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-border bg-transparent px-3 text-xs font-medium text-fg transition-colors hover:border-fg/60">
              Import
              <input
                type="file"
                accept="application/json"
                className="hidden"
                data-testid="import-backup"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void doImport(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
