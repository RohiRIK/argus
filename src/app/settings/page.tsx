"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { IconAlert } from "@/components/icons";
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Label, Segmented, Select } from "@/components/ui/primitives";
import { ThemePicker } from "@/components/theme-picker";

interface GeneralState {
  globalRecipients: string;
  globalRecipientGroupIds: string[];
  adminContacts: string;
  timezone: string;
  retentionDays: string;
  fromAddress: string;
  replyTo: string;
  alertThreshold: string;
  suppressEmptyReports: boolean;
  appVersion: string;
  masterKeyPresent: boolean;
}

const EMPTY: GeneralState = {
  globalRecipients: "",
  globalRecipientGroupIds: [],
  adminContacts: "",
  timezone: "UTC",
  retentionDays: "90",
  fromAddress: "",
  replyTo: "",
  alertThreshold: "0",
  suppressEmptyReports: true,
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

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface MaintenanceWindowRow {
  id: string;
  name: string;
  kind: "recurring" | "oneoff";
  dayOfWeek: number | null;
  startMinute: number | null;
  endMinute: number | null;
  startsAt: string | null;
  endsAt: string | null;
  enabled: boolean;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function fmtMinute(min: number | null): string {
  if (min == null) return "00:00";
  const h = String(Math.floor(min / 60)).padStart(2, "0");
  const m = String(min % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function describeWindow(w: MaintenanceWindowRow): string {
  if (w.kind === "recurring") {
    const day = DAYS[w.dayOfWeek ?? 0] ?? "Sun";
    return `Every ${day} ${fmtMinute(w.startMinute)}–${fmtMinute(w.endMinute)}`;
  }
  return `${w.startsAt?.slice(0, 16).replace("T", " ") ?? ""} → ${w.endsAt?.slice(0, 16).replace("T", " ") ?? ""}`;
}

function parseList(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

export default function GeneralSettingsPage() {
  const [state, setState] = useState<GeneralState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [windows, setWindows] = useState<MaintenanceWindowRow[]>([]);
  const [groups, setGroups] = useState<Array<{ id: string; name: string; memberCount: number }>>([]);
  const [winKind, setWinKind] = useState<"recurring" | "oneoff">("recurring");
  const [winName, setWinName] = useState("");
  const [winDow, setWinDow] = useState("0");
  const [winStartTime, setWinStartTime] = useState("02:00");
  const [winEndTime, setWinEndTime] = useState("04:00");
  const [winStartsAt, setWinStartsAt] = useState("");
  const [winEndsAt, setWinEndsAt] = useState("");
  const [winBusy, setWinBusy] = useState(false);
  const [winErr, setWinErr] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/settings")
      .then((r) => r.json())
      .then((b) => {
        if (!b.success) return;
        const d = b.data;
        setState({
          globalRecipients: (d.globalRecipients ?? []).join(", "),
          globalRecipientGroupIds: Array.isArray(d.globalRecipientGroupIds) ? d.globalRecipientGroupIds : [],
          adminContacts: (d.adminContacts ?? []).join(", "),
          timezone: d.timezone ?? "UTC",
          retentionDays: String(d.retentionDays ?? 90),
          fromAddress: d.fromAddress ?? "",
          replyTo: d.replyTo ?? "",
          alertThreshold: String(d.alertThreshold ?? 0),
          suppressEmptyReports: d.suppressEmptyReports ?? true,
          appVersion: d.appVersion ?? "—",
          masterKeyPresent: d.masterKeyPresent ?? true,
        });
      })
      .finally(() => setLoaded(true));

    void fetch("/api/maintenance-windows")
      .then((r) => r.json())
      .then((b) => b.success && setWindows(b.data));

    void fetch("/api/recipient-groups")
      .then((r) => r.json())
      .then((b) => b.success && setGroups(b.data));
  }, []);

  async function addWindow() {
    setWinBusy(true);
    setWinErr(null);
    const payload =
      winKind === "recurring"
        ? {
            name: winName.trim(),
            kind: "recurring" as const,
            dayOfWeek: Number(winDow),
            startMinute: toMinutes(winStartTime),
            endMinute: toMinutes(winEndTime),
            enabled: true,
          }
        : {
            name: winName.trim(),
            kind: "oneoff" as const,
            startsAt: winStartsAt ? new Date(winStartsAt).toISOString() : "",
            endsAt: winEndsAt ? new Date(winEndsAt).toISOString() : "",
            enabled: true,
          };
    try {
      const res = await fetch("/api/maintenance-windows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const b = await res.json();
      if (b.success) {
        setWindows((prev) => [...prev, b.data]);
        setWinName("");
      } else {
        setWinErr(b.error?.message ?? "Failed to create window");
      }
    } catch (e) {
      setWinErr(e instanceof Error ? e.message : String(e));
    } finally {
      setWinBusy(false);
    }
  }

  async function toggleWindow(w: MaintenanceWindowRow) {
    const res = await fetch(`/api/maintenance-windows/${w.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !w.enabled }),
    });
    const b = await res.json();
    if (b.success) {
      setWindows((prev) => prev.map((x) => (x.id === w.id ? b.data : x)));
    }
  }

  async function deleteWindow(id: string) {
    const res = await fetch(`/api/maintenance-windows/${id}`, { method: "DELETE" });
    const b = await res.json();
    if (b.success) {
      setWindows((prev) => prev.filter((x) => x.id !== id));
    }
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        globalRecipients: parseList(state.globalRecipients),
        globalRecipientGroupIds: state.globalRecipientGroupIds,
        adminContacts: parseList(state.adminContacts),
        language: "en",
        timezone: state.timezone,
        retentionDays: Number(state.retentionDays) || 90,
        fromAddress: state.fromAddress.trim() || null,
        replyTo: state.replyTo.trim() || null,
        alertThreshold: Number(state.alertThreshold) || 0,
        suppressEmptyReports: state.suppressEmptyReports,
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
        ? `Imported ${body.data.imported.jobs} job(s), ${body.data.imported.templates} template(s)${body.data.imported.maintenanceWindows ? `, ${body.data.imported.maintenanceWindows} window(s)` : ""}.`
        : `Import error: ${body.error?.message ?? "failed"}`,
    );
  }

  return (
    <div className="space-y-6" data-testid="general-panel">
      {/* Master key status (UX-F2) */}
      {loaded && !state.masterKeyPresent && (
        <div className="flex items-start gap-3 rounded-lg border border-danger/30 border-l-2 border-l-danger bg-danger/5 p-4" data-testid="master-key-alert">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
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
            <p className="mt-1 text-[11px] text-fg-muted/60">Fallback when a job has no explicit recipients or groups.</p>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <Label className="mb-0">Global default recipient groups</Label>
              <Link href="/settings/recipients" className="text-[11px] font-medium text-primary hover:underline">
                Manage groups →
              </Link>
            </div>
            {groups.length === 0 ? (
              <p className="mt-1 text-[11px] text-fg-muted/60">No recipient groups configured yet.</p>
            ) : (
              <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="global-recipient-groups">
                {groups.map((g) => {
                  const selected = state.globalRecipientGroupIds.includes(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() =>
                        setState((s) => ({
                          ...s,
                          globalRecipientGroupIds: selected
                            ? s.globalRecipientGroupIds.filter((id) => id !== g.id)
                            : [...s.globalRecipientGroupIds, g.id],
                        }))
                      }
                      className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                        selected
                          ? "border-primary bg-primary/15 text-fg"
                          : "border-border/60 bg-surface text-fg-muted hover:border-border hover:text-fg"
                      }`}
                    >
                      {g.name} ({g.memberCount})
                    </button>
                  );
                })}
              </div>
            )}
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

          <ThemePicker />

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <div className="flex items-center justify-between gap-2">
                <Label className="mb-0">Timezone</Label>
                {(() => {
                  const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";
                  return browserTz && TIMEZONES.includes(browserTz) && browserTz !== state.timezone ? (
                    <button
                      type="button"
                      onClick={() => setState((s) => ({ ...s, timezone: browserTz }))}
                      className="text-[11px] font-medium text-primary hover:underline"
                    >
                      Use {browserTz.replace(/_/g, " ")}
                    </button>
                  ) : null;
                })()}
              </div>
              <Select
                value={state.timezone}
                onChange={(e) => setState((s) => ({ ...s, timezone: e.target.value }))}
                data-testid="timezone"
                className="mt-1.5"
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

          <div>
            <Label>Failure alert threshold <span className="text-fg-muted/50">(consecutive failures)</span></Label>
            <Input
              type="number"
              min={0}
              max={50}
              value={state.alertThreshold}
              onChange={(e) => setState((s) => ({ ...s, alertThreshold: e.target.value }))}
              data-testid="alert-threshold"
            />
            <p className="mt-1 text-[11px] text-fg-muted/60">Email admin contacts after a job fails this many times in a row. 0 disables alerts.</p>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={state.suppressEmptyReports}
              onChange={(e) => setState((s) => ({ ...s, suppressEmptyReports: e.target.checked }))}
              className="mt-0.5 h-4 w-4 accent-accent"
              data-testid="suppress-empty"
            />
            <span>
              <span className="text-sm text-fg">Don&apos;t email empty reports</span>
              <span className="mt-0.5 block text-[11px] text-fg-muted/60">When a run finds 0 items, suppress it instead of sending mail. Applies to every report.</span>
            </span>
          </label>

          <div className="flex items-center gap-3 pt-1">
            <Button variant="primary" onClick={save} disabled={saving || !loaded} data-testid="save-general">
              {saving ? "Saving…" : "Save"}
            </Button>
            {msg && <span className="text-xs text-fg-muted">{msg}</span>}
          </div>
        </CardContent>
      </Card>

      <Card data-testid="maintenance-windows-card">
        <CardHeader>
          <CardTitle>Maintenance windows</CardTitle>
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted/60">
            {windows.filter((w) => w.enabled).length} active
          </span>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-fg-muted/80 leading-relaxed">
            Mute report emails during planned maintenance. Jobs still run and record a suppressed execution (and notify webhooks). Recurring windows use your configured timezone ({state.timezone}).
          </p>

          {windows.length > 0 && (
            <div className="divide-y divide-border/40 rounded-lg border border-border/50">
              {windows.map((w) => (
                <div key={w.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5" data-testid={`mw-row-${w.id}`}>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-fg">{w.name}</p>
                    <p className="font-mono text-[11px] text-fg-muted">{describeWindow(w)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => void toggleWindow(w)}>
                      {w.enabled ? "Enabled" : "Disabled"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void deleteWindow(w.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-3 border-t border-border/50 pt-4">
            <div className="flex items-center justify-between gap-3">
              <Label className="mb-0">Add window</Label>
              <Segmented<"recurring" | "oneoff">
                value={winKind}
                onChange={setWinKind}
                options={[{ value: "recurring", label: "Weekly recurring" }, { value: "oneoff", label: "One-off" }]}
              />
            </div>

            <div>
              <Label>Name</Label>
              <Input
                value={winName}
                onChange={(e) => setWinName(e.target.value)}
                placeholder="Sunday patching window"
                data-testid="mw-name"
              />
            </div>

            {winKind === "recurring" ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label>Day</Label>
                  <Select value={winDow} onChange={(e) => setWinDow(e.target.value)} data-testid="mw-dow">
                    {DAYS.map((d, i) => (
                      <option key={d} value={String(i)}>{d}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Start</Label>
                  <Input type="time" value={winStartTime} onChange={(e) => setWinStartTime(e.target.value)} data-testid="mw-start" />
                </div>
                <div>
                  <Label>End</Label>
                  <Input type="time" value={winEndTime} onChange={(e) => setWinEndTime(e.target.value)} data-testid="mw-end" />
                </div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Starts at</Label>
                  <Input type="datetime-local" value={winStartsAt} onChange={(e) => setWinStartsAt(e.target.value)} data-testid="mw-starts-at" />
                </div>
                <div>
                  <Label>Ends at</Label>
                  <Input type="datetime-local" value={winEndsAt} onChange={(e) => setWinEndsAt(e.target.value)} data-testid="mw-ends-at" />
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => void addWindow()} disabled={winBusy || !winName.trim()} data-testid="mw-add">
                {winBusy ? "Adding…" : "Add maintenance window"}
              </Button>
              {winErr && <span className="text-xs text-danger" data-testid="mw-error">{winErr}</span>}
            </div>
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
            <label className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-border bg-transparent px-4 text-sm font-medium text-fg transition-colors hover:bg-surface-2">
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
