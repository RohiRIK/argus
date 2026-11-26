"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  IconAutomations,
  IconEye,
  IconEyeOff,
  IconMicrosoft365,
} from "@/components/icons";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  LinkButton,
  Segmented,
} from "@/components/ui/primitives";

const PROVIDER = "microsoft365-automation";
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ConnStatus = "connected" | "disconnected" | "error";

interface DeployStep {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
  correlationId?: string;
}

interface AutomationDeploySession {
  id: string;
  mode: "create" | "upgrade";
  phase: "awaiting_login" | "running" | "succeeded" | "failed";
  steps: DeployStep[];
  deviceCode?: {
    userCode: string;
    verificationUri: string;
    expiresAt: string;
    intervalSec: number;
  };
  result?: {
    tenantId: string;
    tenantDisplayName: string;
    primaryDomain?: string;
    clientId: string;
    appDisplayName: string;
    certThumbprint: string;
    certExpiresAt: string;
    grantedCount: number;
    missingScopes: string[];
  };
  error?: string;
}

interface CertInfo {
  present: boolean;
  thumbprint: string | null;
  expiresAt: string | null;
  certPem: string | null;
  scripts: { azCli: string; powerShell: string } | null;
}

interface AuditEntry {
  id: string;
  action: string;
  outcome: "success" | "partial" | "error";
  detail: Record<string, unknown>;
  createdAt: string;
}

const STATUS_TONE: Record<ConnStatus, string> = {
  connected: "bg-success/10 text-success border-success/20",
  disconnected: "bg-warning/10 text-warning border-warning/20",
  error: "bg-danger/10 text-danger border-danger/20",
};

const STEP_MARK: Record<DeployStep["status"], string> = {
  pending: "○",
  running: "◌",
  done: "✓",
  error: "✕",
};

const STEP_TONE: Record<DeployStep["status"], string> = {
  pending: "text-fg-muted/60",
  running: "text-info",
  done: "text-success",
  error: "text-danger",
};

export function AutomationIntegrationCard({ keyMissing }: { keyMissing: boolean }) {
  const [open, setOpen] = useState(true);
  const [setupTab, setSetupTab] = useState<"quick" | "advanced">("quick");
  const [scopeMode, setScopeMode] = useState<"all" | "active">("active");
  const [advAuthMode, setAdvAuthMode] = useState<"certificate" | "secret">("certificate");

  const [status, setStatus] = useState<ConnStatus>("disconnected");
  const [configured, setConfigured] = useState(false);
  const [authMode, setAuthMode] = useState<"certificate" | "secret" | "none">("none");
  const [configInfo, setConfigInfo] = useState<{
    tenantDisplayName?: string;
    primaryDomain?: string;
    appDisplayName?: string;
    grantedScopes?: string[];
    missingScopes?: string[];
    activeMissingScopes?: string[];
  }>({});

  // Deploy session
  const [deployBusy, setDeployBusy] = useState(false);
  const [deploySession, setDeploySession] = useState<AutomationDeploySession | null>(null);
  const [deployErr, setDeployErr] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Test & Grant
  const [testing, setTesting] = useState(false);
  const [granting, setGranting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    authOk?: boolean;
    latencyMs?: number;
    grantedCount?: number;
    missingCount?: number;
    message?: string;
  } | null>(null);

  // Advanced manual fields & cert
  const [tenantIdInput, setTenantIdInput] = useState("");
  const [clientIdInput, setClientIdInput] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [savingCreds, setSavingCreds] = useState(false);
  const [credMsg, setCredMsg] = useState<string | null>(null);

  const [certInfo, setCertInfo] = useState<CertInfo | null>(null);
  const [certBusy, setCertBusy] = useState(false);
  const [scriptTab, setScriptTab] = useState<"az" | "ps">("ps");
  const [showScript, setShowScript] = useState(false);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);

  const refreshState = useCallback(async () => {
    const [vaultRes, intRes, certRes, auditRes] = await Promise.all([
      fetch("/api/vault").then((r) => r.json()),
      fetch("/api/integrations").then((r) => r.json()),
      fetch(`/api/integrations/${PROVIDER}/cert`).then((r) => r.json()),
      fetch(`/api/integrations/${PROVIDER}/audit`).then((r) => r.json()),
    ]);
    if (vaultRes.success) {
      setConfigured(Boolean(vaultRes.data.automationConfigured));
      const m = vaultRes.data.automationAuthMode ?? "none";
      setAuthMode(m);
      if (m === "secret") setAdvAuthMode("secret");
    }
    if (intRes.success) {
      const rec = (intRes.data as Array<{ provider: string; status: ConnStatus; config?: typeof configInfo }>).find(
        (i) => i.provider === PROVIDER,
      );
      if (rec) {
        setStatus(rec.status);
        setConfigInfo(rec.config ?? {});
      }
    }
    if (certRes.success) setCertInfo(certRes.data);
    if (auditRes.success) setAuditLog(auditRes.data);
  }, []);

  useEffect(() => {
    void refreshState();
    return () => clearTimeout(pollRef.current);
  }, [refreshState]);

  useEffect(() => {
    if (!deploySession) return;
    if (deploySession.phase !== "awaiting_login" && deploySession.phase !== "running") return;
    const waitMs =
      deploySession.phase === "awaiting_login"
        ? (deploySession.deviceCode?.intervalSec ?? 4) * 1000
        : 1200;
    pollRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/integrations/${PROVIDER}/deploy/${deploySession.id}`);
        const body = await res.json();
        if (body.success) {
          const next: AutomationDeploySession = body.data;
          setDeploySession(next);
          if (next.phase === "succeeded" || next.phase === "failed") {
            await refreshState();
          }
        }
      } catch {
        /* transient retry */
      }
    }, waitMs);
    return () => clearTimeout(pollRef.current);
  }, [deploySession, refreshState]);

  async function startDeploy(mode: "create" | "upgrade") {
    setDeployBusy(true);
    setDeployErr(null);
    try {
      const res = await fetch(`/api/integrations/${PROVIDER}/deploy/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, scopeMode }),
      });
      const body = await res.json();
      if (body.success) setDeploySession(body.data);
      else setDeployErr(body.error?.message ?? "Failed to start Automation deployment");
    } catch (e) {
      setDeployErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDeployBusy(false);
    }
  }

  async function runConnectionTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/integrations/${PROVIDER}/test`, { method: "POST" });
      const body = await res.json();
      if (!body.success) {
        setTestResult({ ok: false, message: body.error?.message ?? "Connection test failed" });
        setStatus("error");
      } else {
        const d = body.data;
        setTestResult({
          ok: Boolean(d.ok),
          authOk: d.steps?.auth?.ok,
          latencyMs: d.steps?.auth?.latencyMs,
          grantedCount: d.steps?.permissions?.granted?.length ?? 0,
          missingCount: d.steps?.permissions?.missing?.length ?? 0,
          message: d.steps?.auth?.error ?? d.steps?.permissions?.error ?? d.steps?.permissions?.note,
        });
        await refreshState();
      }
    } finally {
      setTesting(false);
    }
  }

  async function grantMissing() {
    setGranting(true);
    try {
      const res = await fetch(`/api/integrations/${PROVIDER}/grant`, { method: "POST" });
      const body = await res.json();
      if (body.success) {
        setTestResult({
          ok: body.data.stillMissing.length === 0,
          message: `Granted ${body.data.granted.length} scope(s). Still missing: ${body.data.stillMissing.length}.`,
        });
        await refreshState();
      } else {
        setTestResult({ ok: false, message: body.error?.message ?? "Grant failed" });
      }
    } finally {
      setGranting(false);
    }
  }

  async function generateCert() {
    setCertBusy(true);
    try {
      const res = await fetch(`/api/integrations/${PROVIDER}/cert`, { method: "POST" });
      const body = await res.json();
      if (body.success) {
        setCertInfo(body.data);
        setShowScript(true);
        await refreshState();
      }
    } finally {
      setCertBusy(false);
    }
  }

  async function saveManualCreds() {
    setCredMsg(null);
    const updates: Record<string, string> = {};
    if (tenantIdInput.trim()) {
      if (!GUID_RE.test(tenantIdInput.trim())) {
        setCredMsg("Error: Tenant ID must be a valid UUID/GUID.");
        return;
      }
      updates.auto_tenantId = tenantIdInput.trim();
    }
    if (clientIdInput.trim()) {
      if (!GUID_RE.test(clientIdInput.trim())) {
        setCredMsg("Error: Automation Client ID must be a valid UUID/GUID.");
        return;
      }
      updates.auto_clientId = clientIdInput.trim();
    }
    if (advAuthMode === "secret" && secretInput.trim()) {
      updates.auto_clientSecret = secretInput;
    }
    if (Object.keys(updates).length === 0) {
      setCredMsg("Error: Enter at least one credential field to save.");
      return;
    }

    setSavingCreds(true);
    try {
      const res = await fetch("/api/vault", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updates),
      });
      const body = await res.json();
      if (body.success) {
        setCredMsg("Saved to isolated Automation vault (AES-256-GCM encrypted).");
        setTenantIdInput("");
        setClientIdInput("");
        setSecretInput("");
        await refreshState();
      } else {
        setCredMsg(`Error: ${body.error?.message ?? "Failed to save credentials"}`);
      }
    } finally {
      setSavingCreds(false);
    }
  }

  async function openConsentUrl() {
    const res = await fetch(`/api/integrations/${PROVIDER}/consent-url`);
    const body = await res.json();
    if (body.success && body.data?.url) {
      window.open(body.data.url, "_blank", "noopener,noreferrer");
    } else {
      setCredMsg(`Error: ${body.error?.message ?? "Could not build admin consent URL"}`);
    }
  }

  const isConnected = status === "connected" && configured;
  const grantedCount = configInfo.grantedScopes?.length ?? 0;

  return (
    <Card data-testid="automation-integration-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        data-testid="vendor-microsoft365-automation"
        className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-surface-2/30"
      >
        <div className="flex items-center gap-3">
          <span className={`text-fg-muted transition-transform ${open ? "rotate-90" : ""}`}>›</span>
          <div className="relative flex h-6 w-6 items-center justify-center">
            <IconMicrosoft365 className="h-5 w-5 shrink-0" />
            <span className="absolute -right-1 -bottom-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-surface bg-primary text-primary-fg">
              <IconAutomations className="h-2.5 w-2.5" />
            </span>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-fg">Microsoft 365 Automation</span>
              <Badge className="border-primary/30 bg-primary/10 text-primary">
                Isolated Read-Write App
              </Badge>
              {configInfo.tenantDisplayName && (
                <span className="text-xs text-fg-muted">
                  {configInfo.tenantDisplayName}
                  {configInfo.primaryDomain ? ` (${configInfo.primaryDomain})` : ""}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-fg-muted">
              Dedicated Entra ID Service Principal &amp; X.509 keypair for active tenant guardrails — keeps your Reporting app strictly read-only.
            </p>
          </div>
        </div>
        <span
          className={`rounded-md border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_TONE[status]}`}
          data-testid="m365-automation-status"
        >
          {status}
        </span>
      </button>

      {open && (
        <CardContent className="divide-y divide-border/50 border-t border-border/50 p-0">
          {/* Delivery is shared with reports: no separate sender / recipients for automations. */}
          <p className="px-5 py-3 text-xs text-fg-muted" data-testid="automation-shared-delivery">
            Automation emails use the same sender as reports (Settings &ldquo;From address&rdquo;, else the reporting
            integration mailbox) and the same recipient groups.{" "}
            <Link href="/settings" className="font-medium text-primary hover:underline">
              Sender settings
            </Link>
            {" · "}
            <Link href="/settings/recipients" className="font-medium text-primary hover:underline">
              Recipient groups
            </Link>
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-2/20 px-5 py-3">
            <p className="text-xs text-fg-muted">
              {setupTab === "quick"
                ? "Provision a dedicated 'Argus M365 Automation' App Registration via Device Code."
                : "Manually bind an Entra App Registration and X.509 certificate or secret."}
            </p>
            <Segmented<"quick" | "advanced">
              value={setupTab}
              onChange={setSetupTab}
              options={[
                { value: "quick", label: "Quick Setup" },
                { value: "advanced", label: "Advanced" },
              ]}
            />
          </div>

          {setupTab === "quick" ? (
            <div className="space-y-4 p-5">
              {isConnected && !deploySession ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-fg">
                        {configInfo.appDisplayName ?? "Argus M365 Automation"} Connected
                      </p>
                      <p className="mt-0.5 text-xs text-fg-muted">
                        {authMode === "certificate"
                          ? `X.509 Certificate${certInfo?.expiresAt ? ` · exp ${certInfo.expiresAt.slice(0, 10)}` : ""}`
                          : "Client Secret"}
                        {grantedCount > 0 ? ` · ${grantedCount} Graph scopes granted` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={testing}
                        onClick={() => void runConnectionTest()}
                      >
                        {testing ? "Testing…" : "Test Connection"}
                      </Button>
                      {(configInfo.missingScopes?.length ?? 0) > 0 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={granting}
                          onClick={() => void grantMissing()}
                        >
                          {granting ? "Granting…" : `Grant Missing (${configInfo.missingScopes?.length})`}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        disabled={deployBusy || keyMissing}
                        onClick={() => void startDeploy("create")}
                      >
                        Re-deploy Automation App
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <LinkButton href="/automations" variant="secondary" size="sm">
                      Open Automations Workspace →
                    </LinkButton>
                  </div>
                </div>
              ) : !deploySession ? (
                <div className="space-y-4">
                  <fieldset
                    className="space-y-2 rounded-lg border border-border/60 bg-surface-2/30 p-3.5"
                    data-testid="automation-scope-mode"
                  >
                    <legend className="px-1 text-xs font-semibold text-fg">Which permissions should the app get?</legend>
                    {(
                      [
                        {
                          value: "active",
                          label: "Only automations I've set up (recommended)",
                          hint: "Least privilege: grants just the write scopes of your active automation policies. Re-deploy or Grant Missing after adding more.",
                        },
                        {
                          value: "all",
                          label: "Every automation in the catalog",
                          hint: "Grants the write scopes of all built-in automations up front, even ones you never use.",
                        },
                      ] as const
                    ).map((opt) => (
                      <label key={opt.value} className="flex cursor-pointer items-start gap-2 text-xs">
                        <input
                          type="radio"
                          name="automation-scope-mode"
                          value={opt.value}
                          checked={scopeMode === opt.value}
                          onChange={() => setScopeMode(opt.value)}
                          data-testid={`automation-scope-${opt.value}`}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="font-medium text-fg">{opt.label}</span>
                          <span className="mt-0.5 block text-[11px] text-fg-muted">{opt.hint}</span>
                        </span>
                      </label>
                    ))}
                  </fieldset>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="primary"
                      disabled={deployBusy || keyMissing}
                      onClick={() => void startDeploy("create")}
                      data-testid="deploy-automation-azure-btn"
                    >
                      {deployBusy ? "Starting…" : "Deploy Automation App to Entra ID"}
                    </Button>
                    {configured && (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={testing}
                        onClick={() => void runConnectionTest()}
                      >
                        {testing ? "Testing…" : "Test Existing Credentials"}
                      </Button>
                    )}
                  </div>
                </div>
              ) : null}

              {deployErr && (
                <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
                  ✕ {deployErr}
                </div>
              )}

              {deploySession && (
                <div className="space-y-3 rounded-lg border border-border/70 bg-surface-2/20 p-4">
                  {deploySession.phase === "awaiting_login" && deploySession.deviceCode && (
                    <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3.5">
                      <p className="text-xs font-semibold text-fg">
                        Authorize Entra Provisioning (Global / Privileged Role Admin)
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="rounded border border-border bg-surface px-3 py-1.5 font-mono text-base font-bold tracking-widest text-fg">
                          {deploySession.deviceCode.userCode}
                        </code>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            void navigator.clipboard.writeText(deploySession.deviceCode!.userCode);
                            setCopiedCode(true);
                            setTimeout(() => setCopiedCode(false), 2000);
                          }}
                        >
                          {copiedCode ? "Copied ✓" : "Copy Code"}
                        </Button>
                        <a
                          href={deploySession.deviceCode.verificationUri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-fg hover:bg-primary/90"
                        >
                          Open Microsoft Login ↗
                        </a>
                      </div>
                    </div>
                  )}

                  <ul className="space-y-1.5 text-xs">
                    {deploySession.steps.map((s) => (
                      <li key={s.id} className="flex items-start justify-between gap-2">
                        <span className={STEP_TONE[s.status]}>
                          <span className="mr-2 font-mono">{STEP_MARK[s.status]}</span>
                          {s.label}
                          {s.detail && <span className="ml-2 text-fg-muted">— {s.detail}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {(deploySession.phase === "succeeded" || deploySession.phase === "failed") && (
                    <div className="flex items-center gap-2 pt-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setDeploySession(null)}
                      >
                        Done
                      </Button>
                      {deploySession.phase === "succeeded" && (
                        <Link
                          href="/automations"
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          Configure Automations →
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              )}

              {testResult && (
                <div
                  className={`rounded-lg border p-3 text-xs ${
                    testResult.ok ? "border-success/25 bg-success/5" : "border-warning/30 bg-warning/5"
                  }`}
                >
                  <p className={testResult.ok ? "font-medium text-success" : "font-medium text-warning"}>
                    {testResult.ok
                      ? `✓ Automation Entra Auth Verified (${testResult.latencyMs ?? 0} ms) · ${testResult.grantedCount ?? 0} scopes granted`
                      : `! ${testResult.message ?? `Missing ${testResult.missingCount ?? 0} scope(s)`}`}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-fg">1. Isolated App Credentials</p>
                  <p className="text-xs text-fg-muted">
                    Stored under encrypted `auto_*` vault keys. Tenant ID defaults to your primary M365 Tenant ID if left blank.
                  </p>
                </div>
                <Segmented<"certificate" | "secret">
                  value={advAuthMode}
                  onChange={setAdvAuthMode}
                  options={[
                    { value: "certificate", label: "X.509 Certificate" },
                    { value: "secret", label: "Client Secret" },
                  ]}
                />
              </div>

              {advAuthMode === "certificate" && (
                <div className="space-y-3 rounded-lg border border-border/60 bg-surface-2/20 p-3.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-fg">Dedicated Automation X.509 Certificate</p>
                      <p className="text-fg-muted">
                        {certInfo?.present
                          ? `Thumbprint ${certInfo.thumbprint?.slice(0, 16)}… · expires ${certInfo.expiresAt?.slice(0, 10)}`
                          : "No Automation certificate generated yet."}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={certBusy || keyMissing}
                        onClick={() => void generateCert()}
                      >
                        {certBusy ? "Generating…" : certInfo?.present ? "Rotate Certificate" : "Generate Certificate"}
                      </Button>
                      {certInfo?.present && (
                        <>
                          <a
                            href={`/api/integrations/${PROVIDER}/cert?download=1`}
                            className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium text-fg hover:bg-surface-2"
                          >
                            Download .cer
                          </a>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowScript((v) => !v)}
                          >
                            {showScript ? "Hide Provisioning Script" : "Show Provisioning Script"}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {showScript && certInfo?.scripts && (
                    <div className="space-y-2 pt-2">
                      <Segmented<"ps" | "az">
                        value={scriptTab}
                        onChange={setScriptTab}
                        options={[
                          { value: "ps", label: "PowerShell (MgGraph)" },
                          { value: "az", label: "Azure CLI" },
                        ]}
                      />
                      <pre className="max-h-56 overflow-auto rounded-lg border border-border bg-bg p-3 font-mono text-[11px] text-fg">
                        {scriptTab === "ps" ? certInfo.scripts.powerShell : certInfo.scripts.azCli}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Entra Tenant ID (Optional if shared with Reporting)</Label>
                  <Input
                    value={tenantIdInput}
                    onChange={(e) => setTenantIdInput(e.target.value)}
                    placeholder="00000000-0000-0000-0000-000000000000"
                  />
                </div>
                <div>
                  <Label>Automation App Client ID</Label>
                  <Input
                    value={clientIdInput}
                    onChange={(e) => setClientIdInput(e.target.value)}
                    placeholder="00000000-0000-0000-0000-000000000000"
                  />
                </div>
                {advAuthMode === "secret" && (
                  <div className="sm:col-span-2">
                    <Label>Automation Client Secret</Label>
                    <div className="relative">
                      <Input
                        type={showSecret ? "text" : "password"}
                        value={secretInput}
                        onChange={(e) => setSecretInput(e.target.value)}
                        placeholder="Paste secret Value"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSecret((v) => !v)}
                        className="absolute inset-y-0 right-2.5 flex items-center text-fg-muted hover:text-fg"
                      >
                        {showSecret ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={savingCreds || keyMissing}
                  onClick={() => void saveManualCreds()}
                >
                  {savingCreds ? "Saving…" : "Save Automation Credentials"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void openConsentUrl()}
                >
                  Open Entra Admin Consent ↗
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={testing}
                  onClick={() => void runConnectionTest()}
                >
                  {testing ? "Testing…" : "Test Connection"}
                </Button>
              </div>
              {credMsg && (
                <p className={`text-xs ${credMsg.startsWith("Error:") ? "text-danger" : "text-success"}`}>
                  {credMsg}
                </p>
              )}

              {auditLog.length > 0 && (
                <div className="space-y-2 border-t border-border/50 pt-4">
                  <p className="text-xs font-semibold text-fg">Recent Automation Security Audit Trail</p>
                  <div className="divide-y divide-border/50 rounded-lg border border-border/50 text-xs">
                    {auditLog.slice(0, 5).map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between px-3 py-2">
                        <span className="font-mono text-fg">{entry.action}</span>
                        <span className="text-fg-muted">
                          {entry.outcome.toUpperCase()} · {entry.createdAt.slice(0, 19).replace("T", " ")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
