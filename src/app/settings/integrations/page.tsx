"use client";

import { useCallback, useEffect, useState } from "react";
import { IconMicrosoft365, IconGoogleCloud, IconAws, IconWebhook, IconTrash, IconSend, IconPlus, IconEye, IconEyeOff, IconShield, IconRefresh } from "@/components/icons";
import { Card, CardContent, Button, Input, Label } from "@/components/ui/primitives";
import { parseAdminConsentReturn, hasBootstrapScopes, BOOTSTRAP_SCOPES } from "@/lib/graph-consent";

interface Webhook {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  lastDeliveryStatus: string | null;
}

interface AuditEntry {
  id: string;
  action: string;
  outcome: "success" | "partial" | "error";
  detail: Record<string, unknown>;
  createdAt: string;
}

interface VaultState {
  masterKeyPresent: boolean;
  configured: boolean;
  entries: { key: string; masked: string }[];
}

type ConnStatus = "connected" | "disconnected" | "error";

const PROVIDER = "microsoft365";
const CRED_FIELDS = [
  { key: "tenantId", label: "Entra ID Tenant ID", secret: false },
  { key: "clientId", label: "Entra ID Client ID", secret: false },
  { key: "clientSecret", label: "Entra ID Client Secret", secret: true },
  { key: "mailbox", label: "Shared Mailbox Email", secret: false },
];
const PLACEHOLDERS = [
  { name: "Google Cloud Platform", desc: "GCP audit & IAM reports", icon: IconGoogleCloud },
  { name: "Amazon Web Services", desc: "CloudTrail & IAM reports", icon: IconAws },
  { name: "Custom Webhook", desc: "Generic outbound connector", icon: IconWebhook },
];

const STATUS_TONE: Record<ConnStatus, string> = {
  connected: "bg-success/10 text-success border-success/20",
  disconnected: "bg-warning/10 text-warning border-warning/20",
  error: "bg-danger/10 text-danger border-danger/20",
};
const PERM_TONE: Record<string, string> = {
  ok: "bg-success/10 text-success border-success/20",
  missing: "bg-warning/10 text-warning border-warning/20",
  error: "bg-danger/10 text-danger border-danger/20",
};

export default function IntegrationsPage() {
  const [open, setOpen] = useState(true); // M365 card expanded by default

  // Credentials (vault)
  const [vault, setVault] = useState<VaultState | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [showSecret, setShowSecret] = useState(false);
  const [savingCreds, setSavingCreds] = useState(false);
  const [credMsg, setCredMsg] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnStatus>("disconnected");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Permissions (folded in from the old Permissions tab)
  const [permStatus, setPermStatus] = useState("…");
  const [permLastCheck, setPermLastCheck] = useState<string | null>(null);
  const [permMissing, setPermMissing] = useState<string[]>([]);
  const [permBusy, setPermBusy] = useState(false);
  const [grantBusy, setGrantBusy] = useState(false);
  // Bootstrap readiness: null = unknown (Test Connection not yet run), true/false once known.
  const [bootstrapReady, setBootstrapReady] = useState<boolean | null>(null);
  const [consentBanner, setConsentBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);

  // Webhooks
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [hookMsg, setHookMsg] = useState<string | null>(null);

  const loadVault = useCallback(async () => {
    const res = await fetch("/api/vault");
    const body = await res.json();
    if (body.success) setVault(body.data);
  }, []);

  const loadIntegration = useCallback(async () => {
    const res = await fetch("/api/integrations");
    const body = await res.json();
    if (body.success) {
      const m365 = body.data.find((i: { provider: string; status: ConnStatus }) => i.provider === PROVIDER);
      if (m365) setStatus(m365.status);
    }
  }, []);

  const loadPermissions = useCallback(async () => {
    const res = await fetch("/api/settings/permissions");
    const body = await res.json();
    if (body.success) {
      setPermStatus(body.data.status);
      setPermLastCheck(body.data.lastCheck);
      setPermMissing(body.data.missing ?? []);
    }
  }, []);

  const loadWebhooks = useCallback(async () => {
    const res = await fetch(`/api/integrations/${PROVIDER}/webhooks`);
    const body = await res.json();
    if (body.success) setWebhooks(body.data);
  }, []);

  const loadAudit = useCallback(async () => {
    const res = await fetch(`/api/integrations/${PROVIDER}/audit`);
    const body = await res.json();
    if (body.success) setAuditLog(body.data);
  }, []);

  useEffect(() => {
    void loadVault();
    void loadIntegration();
    void loadPermissions();
    void loadWebhooks();
    void loadAudit();
  }, [loadVault, loadIntegration, loadPermissions, loadWebhooks, loadAudit]);

  // Handle the admin-consent redirect return (?admin_consent=True&tenant=… or ?error=…).
  // On success, surface a result and auto re-run Test Connection; then scrub the query string.
  useEffect(() => {
    const ret = parseAdminConsentReturn(new URLSearchParams(window.location.search));
    if (ret.status === "none") return;
    if (ret.status === "success") {
      setConsentBanner({ ok: true, text: `Self-management authorized${ret.tenant ? ` for tenant ${ret.tenant}` : ""}. Re-testing connection…` });
      void testConnection();
    } else {
      setConsentBanner({ ok: false, text: `Admin consent failed: ${ret.errorDescription ?? ret.error}` });
    }
    window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveCreds() {
    setSavingCreds(true);
    setCredMsg(null);
    const updates = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ""));
    const res = await fetch("/api/vault", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(updates),
    });
    const body = await res.json();
    setCredMsg(body.success ? "Saved — encrypted at rest." : `Error: ${body.error?.message}`);
    setValues({});
    await loadVault();
    setSavingCreds(false);
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/vault/test", { method: "POST" });
      const body = await res.json();
      const r = body.data;
      // Once auth succeeds we can read the granted scope set; derive bootstrap readiness for Step 2.
      if (body.success && r?.steps?.auth?.ok && Array.isArray(r.steps.permissions?.granted)) {
        setBootstrapReady(hasBootstrapScopes(r.steps.permissions.granted));
      }
      if (!body.success) {
        setTestResult({ ok: false, text: body.error?.message });
        setStatus("error");
      } else if (r.ok) {
        setTestResult({ ok: true, text: `Auth OK (${r.steps.auth.latencyMs} ms). All required permissions granted.` });
        setStatus("connected");
      } else if (!r.steps.auth.ok) {
        setTestResult({ ok: false, text: `Auth failed: ${r.steps.auth.error ?? "check credentials"}` });
        setStatus("error");
      } else {
        const miss: string[] = r.steps.permissions?.missing ?? [];
        const detail =
          r.steps.permissions?.error ??
          (miss.length ? `Missing permissions: ${miss.join(", ")}` : r.steps.mailbox?.note ?? "validation failed");
        setTestResult({ ok: false, text: detail });
        setStatus("error");
      }
      await loadPermissions();
    } catch (err) {
      setTestResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
      setStatus("error");
    } finally {
      setTesting(false);
    }
  }

  async function revalidatePermissions() {
    setPermBusy(true);
    await fetch("/api/settings/permissions/remediate", { method: "POST" });
    await loadPermissions();
    setPermBusy(false);
  }

  async function grantPermissions() {
    setGrantBusy(true);
    const res = await fetch(`/api/integrations/${PROVIDER}/grant`, { method: "POST" });
    const body = await res.json();
    if (body.success) {
      const still: string[] = body.data.stillMissing ?? [];
      setTestResult({
        ok: still.length === 0,
        text: still.length === 0 ? "Granted all required permissions." : `Granted ${body.data.granted.join(", ") || "none"}; still missing: ${still.join(", ")}`,
      });
    } else {
      setTestResult({ ok: false, text: body.error?.message ?? "Grant failed" });
    }
    await loadPermissions();
    await loadAudit();
    setGrantBusy(false);
  }

  async function openConsent() {
    const res = await fetch(`/api/integrations/${PROVIDER}/consent-url`);
    const body = await res.json();
    if (body.success) window.open(body.data.url, "_blank", "noopener");
    else setTestResult({ ok: false, text: body.error?.message ?? "Could not build consent URL" });
  }

  async function addWebhook() {
    if (!url.trim()) return;
    setBusy(true);
    setHookMsg(null);
    const res = await fetch(`/api/integrations/${PROVIDER}/webhooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name || "Webhook", url }),
    });
    const body = await res.json();
    if (body.success) {
      setName("");
      setUrl("");
      await loadWebhooks();
    } else setHookMsg(body.error?.message ?? "failed");
    setBusy(false);
  }

  async function removeWebhook(id: string) {
    await fetch(`/api/integrations/${PROVIDER}/webhooks/${id}`, { method: "DELETE" });
    await loadWebhooks();
  }
  async function testWebhook(id: string) {
    const res = await fetch(`/api/integrations/${PROVIDER}/webhooks/${id}/test`, { method: "POST" });
    const body = await res.json();
    setHookMsg(body.success ? `Test → ${body.data.status}` : `Test failed: ${body.error?.message}`);
    await loadWebhooks();
  }

  const keyMissing = vault ? !vault.masterKeyPresent : false;

  return (
    <div className="space-y-4" data-testid="integrations-panel">
      {/* Microsoft 365 — collapsible vendor card */}
      <Card>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          data-testid="vendor-microsoft365"
          className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-surface-2/30"
        >
          <div className="flex items-center gap-3">
            <span className={`text-fg-muted transition-transform ${open ? "rotate-90" : ""}`}>›</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/50 bg-surface-2">
              <IconMicrosoft365 className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold text-fg">Microsoft 365</span>
          </div>
          <span
            className={`rounded-lg border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_TONE[status]}`}
            data-testid="m365-status"
          >
            {status}
          </span>
        </button>

        {open && (
          <CardContent className="space-y-6 border-t border-border/50 pt-5">
            {keyMissing && (
              <p className="rounded-lg border border-danger/20 bg-danger/5 p-3 text-xs text-danger">
                ARGUS_MASTER_KEY is not set — credentials cannot be stored. See the General tab.
              </p>
            )}

            {/* Credentials */}
            <div className="space-y-4">
              <p className="text-xs text-fg-muted/80 leading-relaxed">
                Credentials are AES-256-GCM encrypted at rest. The master key lives only in process memory and is never persisted or logged.
              </p>
              {CRED_FIELDS.map((f) => {
                const current = vault?.entries.find((e) => e.key === f.key);
                return (
                  <div key={f.key}>
                    <Label>
                      {f.label}
                      {current && <span className="ml-2 font-mono text-[10px] text-fg-muted/60">stored: {current.masked}</span>}
                    </Label>
                    <div className="relative">
                      <Input
                        type={f.secret && !showSecret ? "password" : "text"}
                        value={values[f.key] ?? ""}
                        placeholder={current ? "•••••• (unchanged)" : ""}
                        onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                        disabled={keyMissing}
                        data-testid={`cred-${f.key}`}
                      />
                      {f.secret && (
                        <button
                          type="button"
                          onClick={() => setShowSecret((s) => !s)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg transition-colors"
                        >
                          {showSecret ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button variant="primary" onClick={saveCreds} disabled={savingCreds || keyMissing} data-testid="save-creds">
                  {savingCreds ? "Saving…" : "Save credentials"}
                </Button>
                <Button variant="outline" onClick={testConnection} disabled={testing || keyMissing}>
                  {testing ? "Testing…" : "Test Connection"}
                </Button>
                {credMsg && <span className="text-xs text-fg-muted">{credMsg}</span>}
              </div>
              {testResult && (
                <div
                  data-testid="connection-result"
                  className={`rounded-lg border p-3 text-xs ${
                    testResult.ok ? "border-success/20 bg-success/5 text-success" : "border-danger/20 bg-danger/5 text-danger"
                  }`}
                >
                  {testResult.ok ? "✓ " : "✕ "}{testResult.text}
                </div>
              )}
            </div>

            {/* Mailbox permissions (folded in) */}
            <div className="space-y-3 border-t border-border/50 pt-5" data-testid="permissions-panel">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <IconShield className="h-4 w-4 text-fg-muted" />
                  <p className="text-sm font-semibold text-fg">Graph permissions &amp; mailbox</p>
                </div>
                <span className={`rounded-lg border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${PERM_TONE[permStatus] ?? "bg-surface-2 text-fg-muted border-border/40"}`}>
                  {permStatus}
                </span>
              </div>
              <p className="text-xs text-fg-muted/80 leading-relaxed">
                Test Connection reads the app registration&apos;s <span className="font-medium">granted application permissions</span> and
                lists any that are missing. <code className="font-mono text-fg">Mail.Send</code> is required to deliver reports.
                Granting the missing scopes is a deliberate <span className="font-medium">two-step</span> flow.
              </p>

              {consentBanner && (
                <div
                  data-testid="consent-banner"
                  className={`rounded-lg border p-3 text-xs ${
                    consentBanner.ok ? "border-success/20 bg-success/5 text-success" : "border-danger/20 bg-danger/5 text-danger"
                  }`}
                >
                  {consentBanner.ok ? "✓ " : "✕ "}{consentBanner.text}
                </div>
              )}

              {permMissing.length > 0 && (
                <div className="rounded-lg border border-warning/30 bg-warning/5 p-3" data-testid="missing-permissions">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-warning">Missing permissions</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {permMissing.map((p) => (
                      <span key={p} className="rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 font-mono text-[10px] text-warning">{p}</span>
                    ))}
                  </div>

                  {/* Step 1 — one-time admin consent of the two bootstrap scopes. */}
                  <div className="mt-4 rounded-lg border border-border/40 bg-surface-2/30 p-3" data-testid="grant-step-1">
                    <p className="text-xs font-semibold text-fg">Step 1 · Authorize self-management <span className="font-normal text-fg-muted/60">(one-time)</span></p>
                    <p className="mt-1 text-[11px] text-fg-muted/70 leading-relaxed">
                      Adds <code className="font-mono">{BOOTSTRAP_SCOPES[0]}</code> + <code className="font-mono">{BOOTSTRAP_SCOPES[1]}</code> to this app via admin consent, so Argus can grant its own remaining scopes. Add them to the Entra app once, then consent here.
                    </p>
                    <Button variant="outline" size="sm" className="mt-2" onClick={openConsent} data-testid="authorize-self-mgmt">
                      Authorize self-management
                    </Button>
                  </div>

                  {/* Step 2 — programmatic grant of the report scopes. Gated on Step 1. */}
                  <div className="mt-3 rounded-lg border border-border/40 bg-surface-2/30 p-3" data-testid="grant-step-2">
                    <p className="text-xs font-semibold text-fg">Step 2 · Grant missing permissions</p>
                    <p className="mt-1 text-[11px] text-fg-muted/70 leading-relaxed">
                      {bootstrapReady === false
                        ? "Locked until Step 1 is complete — the bootstrap scopes aren't granted yet. Finish Step 1, then Test Connection."
                        : bootstrapReady === null
                          ? "Run Test Connection first to confirm Step 1 is complete and unlock this step."
                          : "Bootstrap scopes detected — Argus can now grant the remaining report scopes programmatically."}
                    </p>
                    <Button
                      variant="primary"
                      size="sm"
                      className="mt-2"
                      disabled={grantBusy || bootstrapReady !== true}
                      onClick={grantPermissions}
                      data-testid="grant-permissions"
                    >
                      {grantBusy ? "Granting…" : "Grant missing permissions"}
                    </Button>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between rounded-lg border border-border/40 bg-surface-2/30 px-4 py-2.5">
                <span className="text-xs text-fg-muted/70">Last checked</span>
                <span className="text-xs tabular-nums text-fg">{permLastCheck ? new Date(permLastCheck).toLocaleString() : "never"}</span>
              </div>
              <Button variant="outline" size="sm" onClick={revalidatePermissions} disabled={permBusy} data-testid="revalidate-permissions">
                <IconRefresh className="h-3.5 w-3.5" /> {permBusy ? "Checking…" : "Re-validate"}
              </Button>

              {auditLog.length > 0 && (
                <div className="rounded-lg border border-border/40 bg-surface-2/20 p-3" data-testid="audit-log">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Recent grant activity</p>
                  <ul className="mt-2 space-y-1">
                    {auditLog.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-3 text-[11px]">
                        <span className="font-mono text-fg-muted/70">{new Date(a.createdAt).toLocaleString()}</span>
                        <span className="truncate text-fg-muted/80">{a.action}</span>
                        <span
                          className={`rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                            a.outcome === "success"
                              ? "bg-success/10 text-success border-success/20"
                              : a.outcome === "partial"
                                ? "bg-warning/10 text-warning border-warning/20"
                                : "bg-danger/10 text-danger border-danger/20"
                          }`}
                        >
                          {a.outcome}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Webhooks */}
            <div className="space-y-4 border-t border-border/50 pt-5">
              <div>
                <p className="text-sm font-semibold text-fg">Webhooks</p>
                <p className="mt-0.5 text-xs text-fg-muted/80 leading-relaxed">
                  Receive suppressed-execution notifications (with full report HTML). Each URL is retried 3× with backoff.
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[140px]">
                  <Label>Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Slack" />
                </div>
                <div className="flex-[2] min-w-[200px]">
                  <Label>Webhook URL</Label>
                  <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.slack.com/…" />
                </div>
                <Button onClick={addWebhook} disabled={busy} className="mb-0.5"><IconPlus className="h-3.5 w-3.5" /> Add</Button>
              </div>
              {hookMsg && <p className="text-xs text-fg-muted">{hookMsg}</p>}
              <div className="divide-y divide-border/50 rounded-lg border border-border/40">
                {webhooks.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-fg-muted/60">No webhooks configured yet.</p>
                ) : (
                  webhooks.map((w) => (
                    <div key={w.id} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2/30 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-fg">{w.name}</p>
                        <p className="truncate font-mono text-[11px] text-fg-muted/60">{w.url}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        {w.lastDeliveryStatus && (
                          <span className={`rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                            w.lastDeliveryStatus === "success"
                              ? "bg-success/10 text-success border-success/20"
                              : "bg-danger/10 text-danger border-danger/20"
                          }`}>
                            {w.lastDeliveryStatus}
                          </span>
                        )}
                        <Button variant="ghost" size="icon" title="Test" onClick={() => testWebhook(w.id)}>
                          <IconSend className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Delete" onClick={() => removeWebhook(w.id)}>
                          <IconTrash className="h-3.5 w-3.5 text-danger" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Placeholder vendor cards */}
      {PLACEHOLDERS.map((p) => {
        const Logo = p.icon;
        return (
        <Card key={p.name} className="opacity-60 border-dashed">
          <div className="flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="text-fg-muted/40">›</span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/50 bg-surface-2 grayscale">
                <Logo className="h-4 w-4 text-fg-muted/50" />
              </div>
              <div>
                <p className="text-sm font-medium text-fg">{p.name}</p>
                <p className="text-xs text-fg-muted/60">{p.desc}</p>
              </div>
            </div>
            <span className="rounded-lg border border-border/40 bg-surface-2/50 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-fg-muted/60">
              Coming soon
            </span>
          </div>
        </Card>
        );
      })}
    </div>
  );
}
