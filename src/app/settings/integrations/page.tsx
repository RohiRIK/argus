"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  IconMicrosoft365,
  IconTrash,
  IconSend,
  IconPlus,
  IconEye,
  IconEyeOff,
  IconRefresh,
} from "@/components/icons";
import {
  Card,
  CardContent,
  Button,
  Input,
  Label,
  Badge,
  LinkButton,
  Segmented,
  Select,
} from "@/components/ui/primitives";
import { GraphConsent } from "@/components/graph-consent";

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
  authMode?: "certificate" | "secret" | "none";
  entries: { key: string; masked: string }[];
}

interface IntegrationRecord {
  provider: string;
  status: ConnStatus;
  config?: {
    tenantDisplayName?: string;
    primaryDomain?: string;
    appDisplayName?: string;
    authMode?: "certificate" | "secret" | "none";
    certExpiresAt?: string | null;
    certThumbprint?: string | null;
    grantedScopes?: string[];
  };
}

interface DeployStep {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
  correlationId?: string;
}

interface DeploySession {
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
    mailbox: string;
    mailboxMode?: "existing" | "create";
    mailboxExists?: boolean;
    dedicatedMailboxAddress?: string;
    dedicatedMailboxExists?: boolean;
    sharedMailboxScript?: string;
    candidateMailboxes?: Array<{ displayName: string; address: string }>;
    provisionedGroups?: Array<{ id: string; name: string; entraLinked: boolean }>;
    grantedCount: number;
    missingScopes: string[];
  };
  error?: string;
  correlationId?: string;
}

interface TenantMailboxItem {
  id: string;
  displayName: string;
  address: string;
  userPrincipalName: string;
  hasLicense: boolean;
}

interface MailboxWorkspaceState {
  configuredMailbox: string | null;
  fromAddress: string | null;
  primaryDomain: string | null;
  suggestedDedicatedAddress: string;
  sharedMailboxScript: string;
  mailboxes: TenantMailboxItem[];
  error: string | null;
}

interface CertInfo {
  present: boolean;
  thumbprint: string | null;
  expiresAt: string | null;
  certPem: string | null;
  scripts: { azCli: string; powerShell: string } | null;
}

type ConnStatus = "connected" | "disconnected" | "error";

const PROVIDER = "microsoft365";
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function StepNumber({ n }: { n: number }) {
  return (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border/70 bg-surface-2 font-mono text-[11px] font-semibold text-fg">
      {n}
    </span>
  );
}

export default function IntegrationsPage() {
  const [open, setOpen] = useState(true);
  const [setupTab, setSetupTab] = useState<"quick" | "advanced">("quick");
  const [syncSeq, setSyncSeq] = useState(0);

  // Vault & credentials
  const [vault, setVault] = useState<VaultState | null>(null);
  const [integration, setIntegration] = useState<IntegrationRecord | null>(null);
  const [advAuthMode, setAdvAuthMode] = useState<"certificate" | "secret">("certificate");
  const [values, setValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showSecret, setShowSecret] = useState(false);
  const [savingCreds, setSavingCreds] = useState(false);
  const [credMsg, setCredMsg] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnStatus>("disconnected");
  const [testing, setTesting] = useState(false);
  const [testSteps, setTestSteps] = useState<{
    ok: boolean;
    auth?: { ok: boolean; latencyMs?: number; error?: string; requestId?: string };
    permissions?: { ok: boolean; readable: boolean; granted: string[]; missing: string[]; error?: string; requestId?: string };
    mailbox?: { ok: boolean; note?: string };
    fallbackText?: string;
  } | null>(null);

  // Quick one-click deploy
  const [deployBusy, setDeployBusy] = useState(false);
  const [deploySession, setDeploySession] = useState<DeploySession | null>(null);
  const [deployErr, setDeployErr] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [starterMsg, setStarterMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Advanced progressive disclosure + mailbox + certificate
  const [showCertScript, setShowCertScript] = useState(false);
  const [showMailboxScript, setShowMailboxScript] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [mailboxData, setMailboxData] = useState<MailboxWorkspaceState | null>(null);
  const [mailboxMode, setMailboxMode] = useState<"existing" | "create">("existing");
  const [selectedExistingMailbox, setSelectedExistingMailbox] = useState("");
  const [dedicatedAddress, setDedicatedAddress] = useState("");
  const [dedicatedDisplayName, setDedicatedDisplayName] = useState("Argus Reports");
  const [generatedMailboxScript, setGeneratedMailboxScript] = useState<string | null>(null);
  const [mailboxMsg, setMailboxMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [mailboxBusy, setMailboxBusy] = useState(false);
  const [testEmailTo, setTestEmailTo] = useState("");
  const [testEmailBusy, setTestEmailBusy] = useState(false);
  const [testEmailMsg, setTestEmailMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copiedScript, setCopiedScript] = useState(false);
  const [certInfo, setCertInfo] = useState<CertInfo | null>(null);
  const [certBusy, setCertBusy] = useState(false);
  const [scriptTab, setScriptTab] = useState<"az" | "ps">("az");

  // Permissions & audit
  const [permStatus, setPermStatus] = useState("…");
  const [permLastCheck, setPermLastCheck] = useState<string | null>(null);
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
    if (body.success) {
      setVault(body.data);
      if (body.data?.configured && body.data?.authMode === "secret") {
        setAdvAuthMode("secret");
      }
    }
  }, []);

  const loadIntegration = useCallback(async () => {
    const res = await fetch("/api/integrations");
    const body = await res.json();
    if (body.success) {
      const m365 = (body.data as IntegrationRecord[]).find((i) => i.provider === PROVIDER) ?? null;
      setIntegration(m365);
      if (m365) setStatus(m365.status);
    }
  }, []);

  const loadPermissions = useCallback(async () => {
    const res = await fetch("/api/settings/permissions");
    const body = await res.json();
    if (body.success) {
      setPermStatus(body.data.status);
      setPermLastCheck(body.data.lastCheck);
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

  const loadCert = useCallback(async () => {
    const res = await fetch(`/api/integrations/${PROVIDER}/cert`);
    const body = await res.json();
    if (body.success) setCertInfo(body.data);
  }, []);

  const loadMailboxes = useCallback(async () => {
    const res = await fetch(`/api/integrations/${PROVIDER}/mailboxes`);
    const body = await res.json();
    if (body.success) {
      const d = body.data as MailboxWorkspaceState;
      setMailboxData(d);
      setSelectedExistingMailbox((prev) => prev || d.configuredMailbox || d.mailboxes[0]?.address || "");
      setDedicatedAddress((prev) => prev || d.suggestedDedicatedAddress);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadVault(), loadIntegration(), loadPermissions(), loadAudit(), loadCert(), loadMailboxes()]);
  }, [loadVault, loadIntegration, loadPermissions, loadAudit, loadCert, loadMailboxes]);

  useEffect(() => {
    void refreshAll();
    void loadWebhooks();
    return () => clearTimeout(pollRef.current);
  }, [refreshAll, loadWebhooks]);

  useEffect(() => {
    if (!deploySession) return;
    if (deploySession.phase !== "awaiting_login" && deploySession.phase !== "running") return;
    const waitMs = deploySession.phase === "awaiting_login" ? (deploySession.deviceCode?.intervalSec ?? 4) * 1000 : 1200;
    pollRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/integrations/${PROVIDER}/deploy/${deploySession.id}`);
        const body = await res.json();
        if (body.success) {
          const next: DeploySession = body.data;
          setDeploySession(next);
          if (next.phase === "succeeded" || next.phase === "failed") {
            if (next.phase === "succeeded" && next.result) {
              const r = next.result;
              if (r.dedicatedMailboxAddress) setDedicatedAddress(r.dedicatedMailboxAddress);
              if (r.sharedMailboxScript) setGeneratedMailboxScript(r.sharedMailboxScript);
              if (r.mailbox) {
                setSelectedExistingMailbox(r.mailbox);
                setTestEmailTo((prev) => prev || r.mailbox);
              } else if (r.candidateMailboxes?.[0]?.address) {
                setSelectedExistingMailbox(r.candidateMailboxes[0].address);
              }
              if (r.dedicatedMailboxExists) setMailboxMode("existing");
              else if (r.mailboxMode === "create") setMailboxMode("create");
            }
            await refreshAll();
            setSyncSeq((s) => s + 1);
          }
        }
      } catch {
        /* transient poll error — next tick will retry */
      }
    }, waitMs);
    return () => clearTimeout(pollRef.current);
  }, [deploySession, refreshAll]);

  async function startDeploy(mode: "create" | "upgrade") {
    setDeployBusy(true);
    setDeployErr(null);
    setStarterMsg(null);
    try {
      const res = await fetch(`/api/integrations/${PROVIDER}/deploy/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const body = await res.json();
      if (body.success) setDeploySession(body.data);
      else setDeployErr(body.error?.message ?? "Failed to start deployment");
    } catch (e) {
      setDeployErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDeployBusy(false);
    }
  }

  async function generateLocalCert() {
    setCertBusy(true);
    try {
      const res = await fetch(`/api/integrations/${PROVIDER}/cert`, { method: "POST" });
      const body = await res.json();
      if (body.success) {
        setCertInfo(body.data);
        setShowCertScript(true);
        await loadVault();
      }
    } finally {
      setCertBusy(false);
    }
  }

  async function deployStarterPack() {
    const res = await fetch("/api/onboarding/starter-pack", { method: "POST" });
    const body = await res.json();
    if (body.success) {
      setStarterMsg(`Deployed ${body.data.createdCount} starter job(s) (${body.data.skippedCount} already existed).`);
    }
  }

  async function saveSelectedMailbox(address: string) {
    const target = address.trim();
    if (!EMAIL_RE.test(target)) {
      setMailboxMsg({ ok: false, text: "Enter a valid sender email address." });
      return;
    }
    setMailboxBusy(true);
    setMailboxMsg(null);
    try {
      const checkRes = await fetch(`/api/integrations/${PROVIDER}/mailboxes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "verify", address: target }),
      });
      const checkBody = await checkRes.json();
      if (checkBody.success && checkBody.data.exists) {
        setMailboxMsg({ ok: true, text: `${checkBody.data.note} Saved as active sender.` });
        await refreshAll();
        return;
      }
      if (vault?.configured && checkBody.success && !checkBody.data.exists) {
        setMailboxMsg({ ok: false, text: checkBody.data.note });
        return;
      }
      const saveRes = await fetch(`/api/integrations/${PROVIDER}/mailboxes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "select", address: target, syncFromAddress: true }),
      });
      const saveBody = await saveRes.json();
      if (saveBody.success) {
        setMailboxMsg({ ok: true, text: `Saved ${target} as sender mailbox.` });
        await refreshAll();
      } else {
        setMailboxMsg({ ok: false, text: saveBody.error?.message ?? "Failed to save mailbox." });
      }
    } finally {
      setMailboxBusy(false);
    }
  }

  async function verifyDedicatedMailbox() {
    const target = dedicatedAddress.trim();
    if (!EMAIL_RE.test(target)) {
      setMailboxMsg({ ok: false, text: "Enter a valid email address for the dedicated mailbox." });
      return;
    }
    setMailboxBusy(true);
    setMailboxMsg(null);
    try {
      const res = await fetch(`/api/integrations/${PROVIDER}/mailboxes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "verify",
          address: target,
          displayName: dedicatedDisplayName.trim() || "Argus Reports",
        }),
      });
      const body = await res.json();
      if (!body.success) {
        setMailboxMsg({ ok: false, text: body.error?.message ?? "Verification failed." });
        return;
      }
      if (body.data.script) setGeneratedMailboxScript(body.data.script);
      if (!body.data.exists) setShowMailboxScript(true);
      setMailboxMsg({
        ok: Boolean(body.data.exists),
        text: body.data.exists
          ? `${body.data.note} Activated as Argus sender mailbox.`
          : `${body.data.note} Run the Exchange PowerShell script below, then click Verify again.`,
      });
      if (body.data.exists) await refreshAll();
    } finally {
      setMailboxBusy(false);
    }
  }

  async function sendTestEmail() {
    const to = testEmailTo.trim();
    if (!EMAIL_RE.test(to)) {
      setTestEmailMsg({ ok: false, text: "Enter a valid recipient email for the test send." });
      return;
    }
    setTestEmailBusy(true);
    setTestEmailMsg(null);
    try {
      const activeFrom =
        mailboxMode === "create"
          ? dedicatedAddress.trim() || mailboxData?.configuredMailbox || undefined
          : selectedExistingMailbox.trim() || mailboxData?.configuredMailbox || undefined;
      const res = await fetch(`/api/integrations/${PROVIDER}/mailboxes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "test-send", from: activeFrom, to }),
      });
      const body = await res.json();
      if (body.success) {
        setTestEmailMsg({ ok: true, text: `Sent test email from ${body.data.from} → ${body.data.to}.` });
        await loadAudit();
      } else {
        setTestEmailMsg({ ok: false, text: body.error?.message ?? "Test email failed." });
      }
    } finally {
      setTestEmailBusy(false);
    }
  }

  function validateField(key: string, raw: string): string | null {
    const v = raw.trim();
    if (!v) return null;
    if ((key === "tenantId" || key === "clientId") && !GUID_RE.test(v)) return "Must be a valid UUID/GUID";
    if (key === "mailbox" && !EMAIL_RE.test(v)) return "Must be a valid email address";
    return null;
  }

  async function saveCreds() {
    setCredMsg(null);
    const allowedKeys = advAuthMode === "certificate" ? ["tenantId", "clientId"] : ["tenantId", "clientId", "clientSecret"];
    const updates = Object.fromEntries(
      Object.entries(values).filter(([k, v]) => allowedKeys.includes(k) && v.trim() !== ""),
    );
    if (Object.keys(updates).length === 0) {
      setCredMsg("Error: Enter at least one credential field to update.");
      return;
    }
    const errs: Record<string, string> = {};
    for (const [k, v] of Object.entries(updates)) {
      const err = validateField(k, v);
      if (err) errs[k] = err;
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setCredMsg("Error: Fix invalid fields before saving.");
      return;
    }

    setSavingCreds(true);
    setFieldErrors({});
    try {
      const res = await fetch("/api/vault", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updates),
      });
      const body = await res.json();
      if (body.success) {
        setCredMsg("Saved — encrypted at rest.");
        setValues({});
        await refreshAll();
        setSyncSeq((s) => s + 1);
      } else {
        if (body.error?.fields) setFieldErrors(body.error.fields);
        setCredMsg(`Error: ${body.error?.message ?? "Save failed"}`);
      }
    } catch (e) {
      setCredMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingCreds(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestSteps(null);
    try {
      const res = await fetch("/api/vault/test", { method: "POST" });
      const body = await res.json();
      if (!body.success) {
        setTestSteps({ ok: false, fallbackText: body.error?.message ?? "Test failed" });
        setStatus("error");
      } else {
        const r = body.data;
        setTestSteps({
          ok: Boolean(r.ok),
          auth: r.steps?.auth,
          permissions: r.steps?.permissions,
          mailbox: r.steps?.mailbox,
        });
        await refreshAll();
        setSyncSeq((s) => s + 1);
      }
    } catch (err) {
      setTestSteps({ ok: false, fallbackText: err instanceof Error ? err.message : String(err) });
      setStatus("error");
    } finally {
      setTesting(false);
    }
  }

  async function addWebhook() {
    if (!url.trim()) return;
    setBusy(true);
    setHookMsg(null);
    try {
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
    } finally {
      setBusy(false);
    }
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
  const authMode = vault?.authMode ?? integration?.config?.authMode ?? "none";
  const tenantDisplay = integration?.config?.tenantDisplayName;
  const primaryDomain = integration?.config?.primaryDomain;
  const appDisplay = integration?.config?.appDisplayName;
  const grantedCount = integration?.config?.grantedScopes?.length ?? 0;
  const isConnected = status === "connected" && Boolean(vault?.configured);

  const visibleCredFields = [
    { key: "tenantId", label: "Entra ID Tenant ID", secret: false },
    { key: "clientId", label: "Entra ID Client ID", secret: false },
    ...(advAuthMode === "secret" ? [{ key: "clientSecret", label: "Entra ID Client Secret", secret: true }] : []),
  ];

  const connectionResultBox = testSteps && (
    <div
      data-testid="connection-result"
      className={`space-y-1.5 rounded-lg border p-3 text-xs ${
        testSteps.ok ? "border-success/25 bg-success/5" : "border-danger/25 bg-danger/5"
      }`}
    >
      {testSteps.fallbackText ? (
        <p className="text-danger">✕ {testSteps.fallbackText}</p>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className={testSteps.auth?.ok ? "text-success" : "text-danger"}>
              {testSteps.auth?.ok ? `✓ 1. Entra Auth (${testSteps.auth.latencyMs} ms)` : `✕ 1. Entra Auth: ${testSteps.auth?.error}`}
            </span>
            {testSteps.auth?.requestId && <span className="font-mono text-[10px] text-fg-muted">req: {testSteps.auth.requestId}</span>}
          </div>
          <div className="flex items-center justify-between">
            <span className={testSteps.permissions?.ok ? "text-success" : "text-warning"}>
              {testSteps.permissions?.ok
                ? `✓ 2. Permissions (${testSteps.permissions.granted.length} verified)`
                : `! 2. Permissions: ${testSteps.permissions?.error ?? `${testSteps.permissions?.missing.length ?? 0} missing`}`}
            </span>
            {testSteps.permissions?.requestId && <span className="font-mono text-[10px] text-fg-muted">req: {testSteps.permissions.requestId}</span>}
          </div>
          <div className={testSteps.mailbox?.ok ? "text-success" : "text-warning"}>
            {testSteps.mailbox?.ok ? `✓ 3. Mailbox (${testSteps.mailbox.note})` : `! 3. Mailbox: ${testSteps.mailbox?.note}`}
          </div>
          {testSteps.ok && (
            <div className="pt-1">
              <Link href="/dashboard" className="text-[11px] font-medium text-primary hover:underline">
                Continue to Dashboard →
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-4" data-testid="integrations-panel">
      <Card>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          data-testid="vendor-microsoft365"
          className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-surface-2/30"
        >
          <div className="flex items-center gap-3">
            <span className={`text-fg-muted transition-transform ${open ? "rotate-90" : ""}`}>›</span>
            <IconMicrosoft365 className="h-5 w-5 shrink-0" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-fg">Microsoft 365</span>
                {tenantDisplay && (
                  <span className="text-xs text-fg-muted" data-testid="discovered-tenant">
                    {tenantDisplay}{primaryDomain ? ` (${primaryDomain})` : ""}
                  </span>
                )}
              </div>
              {vault?.configured && authMode !== "none" && (
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <Badge>
                    {authMode === "certificate"
                      ? `X.509 Certificate${certInfo?.expiresAt ? ` · exp ${certInfo.expiresAt.slice(0, 10)}` : ""}`
                      : "Client Secret"}
                  </Badge>
                </div>
              )}
            </div>
          </div>
          <span
            className={`rounded-md border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_TONE[status]}`}
            data-testid="m365-status"
          >
            {status}
          </span>
        </button>

        {open && (
          <CardContent className="divide-y divide-border/50 border-t border-border/50 p-0">
            {keyMissing && (
              <div className="bg-danger/5 px-5 py-3 text-xs text-danger">
                ARGUS_MASTER_KEY is not set — credentials cannot be encrypted. See the General tab.
              </div>
            )}

            {/* Mode bar: Quick Setup (1-button Device Code) vs Advanced (step-by-step manual setup) */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-2/20 px-5 py-3">
              <p className="text-xs text-fg-muted">
                {setupTab === "quick"
                  ? "Automated Entra ID provisioning via Microsoft Device Code."
                  : "Configure app authentication, Graph permissions, and sender mailbox in order."}
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
              <div className="space-y-4 p-5" data-testid="one-click-deploy">
                {isConnected && !deploySession ? (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-fg">
                          Connected to {tenantDisplay ?? "Microsoft 365"}
                        </p>
                        <p className="mt-0.5 text-xs text-fg-muted">
                          {appDisplay ?? "Argus M365"} · {authMode === "certificate" ? "X.509 certificate" : "Client secret"}
                          {grantedCount > 0 ? ` · ${grantedCount} Graph scopes` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => void testConnection()} disabled={testing}>
                          {testing ? "Testing…" : "Test Connection"}
                        </Button>
                        {authMode !== "certificate" && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={deployBusy || keyMissing}
                            onClick={() => void startDeploy("upgrade")}
                            data-testid="upgrade-cert-btn"
                          >
                            Upgrade to certificate
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          disabled={deployBusy || keyMissing}
                          onClick={() => void startDeploy("create")}
                          data-testid="deploy-azure-btn"
                        >
                          {deployBusy ? "Starting…" : "Re-deploy app"}
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-3 rounded-lg border border-border/50 bg-surface-2/20 p-3.5 text-xs sm:grid-cols-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-fg-muted/70">Domain</p>
                        <p className="mt-0.5 font-mono text-fg">{primaryDomain ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-fg-muted/70">Sender mailbox</p>
                        <div className="mt-0.5 flex items-center gap-2">
                          <p className="truncate font-mono text-fg">{mailboxData?.configuredMailbox ?? "Not configured"}</p>
                          <button
                            type="button"
                            onClick={() => setSetupTab("advanced")}
                            className="shrink-0 text-[11px] font-medium text-primary hover:underline"
                          >
                            {mailboxData?.configuredMailbox ? "Change / create" : "Configure"}
                          </button>
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-fg-muted/70">Permissions</p>
                        <p className="mt-0.5 font-medium uppercase text-fg">{permStatus}</p>
                      </div>
                    </div>

                    {connectionResultBox}

                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => void deployStarterPack()} data-testid="deploy-starter-pack">
                        Deploy 4 Starter Reports
                      </Button>
                      <LinkButton href="/settings/recipients" variant="outline" size="sm">
                        Manage Recipient Groups
                      </LinkButton>
                    </div>
                    {starterMsg && <p className="text-xs text-fg-muted">{starterMsg}</p>}
                  </>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-fg">Deploy Argus to Microsoft 365</p>
                        <p className="text-xs text-fg-muted leading-relaxed">
                          Sign in once with Microsoft Device Code. Argus generates an X.509 certificate, registers the Entra ID app, grants all Graph scopes, and verifies connectivity.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="primary"
                        onClick={() => void startDeploy("create")}
                        disabled={deployBusy || keyMissing}
                        data-testid="deploy-azure-btn"
                      >
                        {deployBusy ? "Starting…" : "Deploy to Microsoft 365"}
                      </Button>
                    </div>

                    {deployErr && (
                      <p className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
                        ✕ {deployErr}
                      </p>
                    )}

                    {deploySession && (
                      <div className="space-y-3 rounded-lg border border-border/60 bg-surface-2/30 p-4" data-testid="deploy-progress">
                        {deploySession.phase === "awaiting_login" && deploySession.deviceCode && (
                          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
                            <div className="space-y-1">
                              <p className="text-xs font-semibold text-fg">Enter this code at Microsoft Device Login</p>
                              <div className="flex items-center gap-2">
                                <code className="rounded bg-sidebar-bg px-3 py-1 font-mono text-base font-semibold tracking-widest text-sidebar-fg">
                                  {deploySession.deviceCode.userCode}
                                </code>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    void navigator.clipboard.writeText(deploySession.deviceCode!.userCode);
                                    setCopiedCode(true);
                                    setTimeout(() => setCopiedCode(false), 1500);
                                  }}
                                >
                                  {copiedCode ? "Copied" : "Copy code"}
                                </Button>
                              </div>
                            </div>
                            <a
                              href={deploySession.deviceCode.verificationUri}
                              target="_blank"
                              rel="noopener"
                              className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-xs font-medium text-primary-fg hover:bg-primary/90"
                            >
                              Open Microsoft Sign-in ↗
                            </a>
                          </div>
                        )}

                        <ul className="space-y-1.5">
                          {deploySession.steps.map((s) => (
                            <li key={s.id} className="flex items-start justify-between gap-3 text-xs">
                              <div className="flex items-start gap-2">
                                <span className={`font-mono font-semibold ${STEP_TONE[s.status]}`}>{STEP_MARK[s.status]}</span>
                                <div>
                                  <span className="font-medium text-fg">{s.label}</span>
                                  {s.detail && <p className="text-[11px] text-fg-muted">{s.detail}</p>}
                                  {s.correlationId && (
                                    <p className="font-mono text-[10px] text-fg-muted/70">Correlation ID: {s.correlationId}</p>
                                  )}
                                </div>
                              </div>
                              <span className={`font-mono text-[10px] uppercase ${STEP_TONE[s.status]}`}>{s.status}</span>
                            </li>
                          ))}
                        </ul>

                        {deploySession.phase === "failed" && (
                          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3">
                            <span className="text-xs text-danger">{deploySession.error}</span>
                            <Button type="button" variant="outline" size="sm" onClick={() => void startDeploy(deploySession.mode)}>
                              Retry deployment
                            </Button>
                          </div>
                        )}

                        {deploySession.phase === "succeeded" && deploySession.result && (
                          <div className="space-y-4 border-t border-border/50 pt-3">
                            <p className="text-xs font-semibold text-success">
                              ✓ Connected to {deploySession.result.tenantDisplayName} ({deploySession.result.grantedCount} scopes granted)
                            </p>

                            {deploySession.result.provisionedGroups && deploySession.result.provisionedGroups.length > 0 && (
                              <div className="space-y-1.5 rounded-lg border border-border/50 bg-surface p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-xs font-medium text-fg">
                                    Entra ID recipient groups provisioned ({deploySession.result.provisionedGroups.filter((g) => g.entraLinked).length}/{deploySession.result.provisionedGroups.length})
                                  </span>
                                  <Link href="/settings/recipients" className="text-[11px] font-medium text-primary hover:underline">
                                    Manage members →
                                  </Link>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {deploySession.result.provisionedGroups.map((g) => (
                                    <Badge key={g.id}>
                                      {g.entraLinked ? "Entra · " : "Local · "}
                                      {g.name}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className="space-y-3 rounded-lg border border-border/50 bg-surface p-3.5" data-testid="deploy-mailbox-setup">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="text-xs font-semibold text-fg">Sender mailbox (Mail.Send)</p>
                                  <p className="text-[11px] text-fg-muted">
                                    Active:{" "}
                                    <code className="font-mono text-fg">
                                      {mailboxData?.configuredMailbox ?? deploySession.result.mailbox ?? "Not configured"}
                                    </code>
                                  </p>
                                </div>
                                <Segmented<"existing" | "create">
                                  value={mailboxMode}
                                  onChange={(nextMode) => {
                                    setMailboxMode(nextMode);
                                    setMailboxMsg(null);
                                  }}
                                  options={[
                                    { value: "existing", label: "Use existing" },
                                    { value: "create", label: "Create dedicated" },
                                  ]}
                                />
                              </div>

                              {mailboxMode === "existing" ? (
                                <div className="space-y-2.5">
                                  <div className="flex flex-wrap gap-2">
                                    <Select
                                      value={selectedExistingMailbox}
                                      onChange={(e) => setSelectedExistingMailbox(e.target.value)}
                                      disabled={!(mailboxData?.mailboxes?.length || deploySession.result.candidateMailboxes?.length)}
                                      className="min-w-[220px] flex-1 text-xs"
                                    >
                                      {(mailboxData?.mailboxes?.length
                                        ? mailboxData.mailboxes
                                        : deploySession.result.candidateMailboxes ?? []
                                      ).map((m) => (
                                        <option key={m.address} value={m.address}>
                                          {m.displayName ? `${m.displayName} — ${m.address}` : m.address}
                                        </option>
                                      ))}
                                    </Select>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      disabled={mailboxBusy || !selectedExistingMailbox}
                                      onClick={() => void saveSelectedMailbox(selectedExistingMailbox)}
                                    >
                                      {mailboxBusy ? "Saving…" : "Save sender"}
                                    </Button>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Input
                                      value={testEmailTo}
                                      onChange={(e) => setTestEmailTo(e.target.value)}
                                      placeholder="Test recipient (e.g. you@domain.com)"
                                      className="min-w-[220px] flex-1 font-mono text-xs"
                                    />
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      disabled={testEmailBusy || !testEmailTo.trim()}
                                      onClick={() => void sendTestEmail()}
                                    >
                                      {testEmailBusy ? "Sending…" : "Send test email"}
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-2.5">
                                  <p className="text-[11px] text-fg-muted leading-relaxed">
                                    Microsoft Graph cannot create Exchange Shared Mailboxes via API. Run this Exchange Online PowerShell snippet once to create an unlicensed Shared Mailbox + least-privilege <code className="font-mono text-fg">Application Mail.Send</code> RBAC scope, then verify.
                                  </p>
                                  <div className="flex flex-wrap gap-2">
                                    <Input
                                      value={dedicatedAddress}
                                      onChange={(e) => setDedicatedAddress(e.target.value)}
                                      placeholder={deploySession.result.dedicatedMailboxAddress || "argus@yourdomain.com"}
                                      className="min-w-[220px] flex-1 font-mono text-xs"
                                    />
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      disabled={mailboxBusy}
                                      onClick={() => void verifyDedicatedMailbox()}
                                    >
                                      {mailboxBusy ? "Checking…" : "Verify & activate"}
                                    </Button>
                                    {(generatedMailboxScript || deploySession.result.sharedMailboxScript || mailboxData?.sharedMailboxScript) && (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                          const text =
                                            generatedMailboxScript ??
                                            deploySession.result?.sharedMailboxScript ??
                                            mailboxData?.sharedMailboxScript ??
                                            "";
                                          void navigator.clipboard.writeText(text);
                                          setCopiedScript(true);
                                          setTimeout(() => setCopiedScript(false), 1500);
                                        }}
                                      >
                                        {copiedScript ? "Copied script" : "Copy PowerShell"}
                                      </Button>
                                    )}
                                  </div>
                                  {(generatedMailboxScript || deploySession.result.sharedMailboxScript || mailboxData?.sharedMailboxScript) && (
                                    <pre className="max-h-40 overflow-x-auto rounded border border-border/50 bg-sidebar-bg p-2.5 font-mono text-[10px] leading-relaxed text-sidebar-fg">
                                      {generatedMailboxScript ?? deploySession.result.sharedMailboxScript ?? mailboxData?.sharedMailboxScript}
                                    </pre>
                                  )}
                                </div>
                              )}

                              {mailboxMsg && (
                                <p className={`text-[11px] ${mailboxMsg.ok ? "text-success" : "text-danger"}`}>
                                  {mailboxMsg.ok ? "✓ " : "✕ "}
                                  {mailboxMsg.text}
                                </p>
                              )}
                              {testEmailMsg && (
                                <p className={`text-[11px] ${testEmailMsg.ok ? "text-success" : "text-danger"}`}>
                                  {testEmailMsg.ok ? "✓ " : "✕ "}
                                  {testEmailMsg.text}
                                </p>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <Button type="button" variant="primary" size="sm" onClick={() => void deployStarterPack()} data-testid="deploy-starter-pack">
                                Deploy 4 Starter Reports
                              </Button>
                              <LinkButton href="/settings/recipients" variant="outline" size="sm">
                                Manage Recipient Groups
                              </LinkButton>
                              <LinkButton href="/dashboard" variant="outline" size="sm">
                                Open Dashboard →
                              </LinkButton>
                              {starterMsg && <span className="text-xs text-fg-muted">{starterMsg}</span>}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <>
                {/* Advanced Step 1: App registration, certificate/secret & Tenant/Client IDs */}
                <div className="space-y-4 p-5" data-testid="manual-creds-panel">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <StepNumber n={1} />
                      <div>
                        <p className="text-sm font-semibold text-fg">App registration &amp; authentication</p>
                        <p className="text-xs text-fg-muted">
                          Choose certificate or secret auth, save your Entra IDs (encrypted via AES-256-GCM), then test auth.
                        </p>
                      </div>
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
                    <div className="space-y-2.5 rounded-lg border border-border/60 bg-surface-2/20 p-3.5" data-testid="advanced-cert-panel">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs">
                          <span className="font-medium text-fg">
                            {certInfo?.present ? "Local X.509 certificate ready" : "Generate local RSA-2048 X.509 certificate"}
                          </span>
                          {certInfo?.present && certInfo.thumbprint && (
                            <p className="font-mono text-[10px] text-fg-muted">
                              Thumbprint: {certInfo.thumbprint} · Expires {certInfo.expiresAt?.slice(0, 10)}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button type="button" variant="outline" size="sm" disabled={certBusy || keyMissing} onClick={() => void generateLocalCert()}>
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
                              <Button type="button" variant="ghost" size="sm" onClick={() => setShowCertScript((s) => !s)}>
                                {showCertScript ? "Hide script" : "Show CLI script"}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>

                      {showCertScript && certInfo?.present && certInfo.scripts && (
                        <div className="space-y-2 border-t border-border/50 pt-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-fg-muted">Creates the Entra app, uploads the public <code className="font-mono">.cer</code>, and grants scopes:</span>
                            <div className="flex gap-1">
                              <Button type="button" variant={scriptTab === "az" ? "secondary" : "ghost"} size="sm" onClick={() => setScriptTab("az")}>
                                az CLI
                              </Button>
                              <Button type="button" variant={scriptTab === "ps" ? "secondary" : "ghost"} size="sm" onClick={() => setScriptTab("ps")}>
                                PowerShell
                              </Button>
                            </div>
                          </div>
                          <pre className="max-h-48 overflow-auto rounded-md bg-sidebar-bg p-3 font-mono text-[10px] leading-relaxed text-sidebar-fg">
                            {scriptTab === "az" ? certInfo.scripts.azCli : certInfo.scripts.powerShell}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    {visibleCredFields.map((f) => {
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
                              onChange={(e) => {
                                const val = e.target.value;
                                setValues((v) => ({ ...v, [f.key]: val }));
                                if (fieldErrors[f.key]) {
                                  setFieldErrors((fe) => {
                                    const next = { ...fe };
                                    delete next[f.key];
                                    return next;
                                  });
                                }
                              }}
                              onBlur={(e) => {
                                const err = validateField(f.key, e.target.value);
                                setFieldErrors((fe) => {
                                  const next = { ...fe };
                                  if (err) next[f.key] = err;
                                  else delete next[f.key];
                                  return next;
                                });
                              }}
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
                          {fieldErrors[f.key] && <p className="mt-1 text-[11px] text-danger">{fieldErrors[f.key]}</p>}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant="primary" size="sm" onClick={() => void saveCreds()} disabled={savingCreds || keyMissing} data-testid="save-creds">
                      {savingCreds ? "Saving…" : "Save credentials"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void testConnection()} disabled={testing || keyMissing}>
                      {testing ? "Testing…" : "Test Connection"}
                    </Button>
                    {credMsg && <span className={`text-xs ${credMsg.startsWith("Error") ? "text-danger" : "text-fg-muted"}`}>{credMsg}</span>}
                  </div>

                  {connectionResultBox}
                </div>

                {/* Advanced Step 2: Graph Permissions */}
                <div className="space-y-3 p-5" data-testid="permissions-panel">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <StepNumber n={2} />
                      <div>
                        <p className="text-sm font-semibold text-fg">Graph permissions</p>
                        <p className="text-xs text-fg-muted">
                          Grant all required application scopes via Microsoft admin consent and re-validate live.
                        </p>
                      </div>
                    </div>
                    <span
                      className={`rounded-md border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                        PERM_TONE[permStatus] ?? "bg-surface-2 text-fg-muted border-border/40"
                      }`}
                    >
                      {permStatus}
                    </span>
                  </div>

                  <GraphConsent variant="full" refreshKey={syncSeq} onSynced={() => void refreshAll()} />

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-3 text-xs">
                    <span className="text-fg-muted">
                      Last checked: <span className="tabular-nums text-fg">{permLastCheck ? new Date(permLastCheck).toLocaleString() : "never"}</span>
                    </span>
                    {auditLog.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowAuditLog((s) => !s)}
                        className="text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline"
                      >
                        {showAuditLog ? "Hide activity log" : `Activity log (${auditLog.length})`}
                      </button>
                    )}
                  </div>

                  {showAuditLog && auditLog.length > 0 && (
                    <div data-testid="audit-log">
                      <ul className="divide-y divide-border/40 rounded-lg border border-border/50">
                        {auditLog.map((a) => {
                          const errText = typeof a.detail?.error === "string" ? a.detail.error : null;
                          return (
                            <li key={a.id} className="px-3 py-2 text-[11px]">
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-mono text-fg-muted/80">{new Date(a.createdAt).toLocaleString()}</span>
                                <span className="truncate font-medium text-fg">{a.action}</span>
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
                              </div>
                              {errText && <p className="mt-1 text-[10px] text-danger">{errText}</p>}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Advanced Step 3: Sender Mailbox & Delivery Verification */}
                <div className="space-y-4 p-5" data-testid="sender-mailbox-panel">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <StepNumber n={3} />
                      <div>
                        <p className="text-sm font-semibold text-fg">Sender mailbox (Graph Mail.Send)</p>
                        <p className="text-xs text-fg-muted">
                          Pick an existing M365 mailbox or provision a dedicated Shared Mailbox scoped by Exchange RBAC.{" "}
                          {mailboxData?.configuredMailbox && (
                            <span className="font-mono text-fg">Active: {mailboxData.configuredMailbox}</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <Segmented<"existing" | "create">
                      value={mailboxMode}
                      onChange={setMailboxMode}
                      options={[
                        { value: "existing", label: "Use existing mailbox" },
                        { value: "create", label: "Create dedicated mailbox" },
                      ]}
                    />
                  </div>

                  {mailboxMode === "existing" ? (
                    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                      <div>
                        <div className="flex items-center justify-between">
                          <Label>Tenant mailboxes</Label>
                          <button
                            type="button"
                            onClick={() => void loadMailboxes()}
                            className="mb-1 inline-flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg"
                          >
                            <IconRefresh className="h-3 w-3" /> Refresh
                          </button>
                        </div>
                        <Select
                          value={selectedExistingMailbox}
                          onChange={(e) => setSelectedExistingMailbox(e.target.value)}
                          data-testid="existing-mailbox-select"
                          disabled={!mailboxData?.mailboxes?.length}
                        >
                          {!mailboxData?.mailboxes?.length ? (
                            <option value="">Complete Steps 1–2 to load mailboxes…</option>
                          ) : (
                            mailboxData.mailboxes.map((m) => (
                              <option key={m.id} value={m.address}>
                                {m.displayName} ({m.address}){m.hasLicense ? "" : " — shared/unlicensed"}
                              </option>
                            ))
                          )}
                        </Select>
                      </div>
                      <div>
                        <Label>Or enter mailbox address</Label>
                        <Input
                          value={selectedExistingMailbox}
                          onChange={(e) => setSelectedExistingMailbox(e.target.value)}
                          placeholder={primaryDomain ? `alerts@${primaryDomain}` : "alerts@contoso.com"}
                          data-testid="existing-mailbox-input"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        disabled={mailboxBusy || keyMissing || !selectedExistingMailbox.trim()}
                        onClick={() => void saveSelectedMailbox(selectedExistingMailbox)}
                        data-testid="save-existing-mailbox"
                      >
                        {mailboxBusy ? "Verifying…" : "Verify & Save"}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
                        <div>
                          <Label>Dedicated shared mailbox address</Label>
                          <Input
                            value={dedicatedAddress}
                            onChange={(e) => setDedicatedAddress(e.target.value)}
                            placeholder={primaryDomain ? `argus@${primaryDomain}` : "argus@yourdomain.com"}
                            data-testid="dedicated-mailbox-address"
                          />
                        </div>
                        <div>
                          <Label>Display name</Label>
                          <Input
                            value={dedicatedDisplayName}
                            onChange={(e) => setDedicatedDisplayName(e.target.value)}
                            placeholder="Argus Reports"
                            data-testid="dedicated-mailbox-name"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          disabled={mailboxBusy || keyMissing || !dedicatedAddress.trim()}
                          onClick={() => void verifyDedicatedMailbox()}
                          data-testid="verify-dedicated-mailbox"
                        >
                          {mailboxBusy ? "Checking…" : "Verify & activate"}
                        </Button>
                      </div>

                      {(generatedMailboxScript || mailboxData?.sharedMailboxScript) && (
                        <div className="space-y-2 rounded-lg border border-border/60 bg-surface-2/20 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs text-fg-muted">
                              Exchange Online PowerShell creates the free Shared Mailbox and scopes <code className="font-mono text-fg">Mail.Send</code> to it.
                            </p>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  const txt = generatedMailboxScript ?? mailboxData?.sharedMailboxScript ?? "";
                                  void navigator.clipboard.writeText(txt);
                                  setCopiedScript(true);
                                  setTimeout(() => setCopiedScript(false), 1500);
                                }}
                              >
                                {copiedScript ? "Copied" : "Copy script"}
                              </Button>
                              <Button type="button" variant="ghost" size="sm" onClick={() => setShowMailboxScript((s) => !s)}>
                                {showMailboxScript ? "Hide script" : "Show script"}
                              </Button>
                            </div>
                          </div>
                          {showMailboxScript && (
                            <pre className="max-h-44 overflow-auto rounded bg-sidebar-bg p-3 font-mono text-[10px] leading-relaxed text-sidebar-fg">
                              {generatedMailboxScript ?? mailboxData?.sharedMailboxScript}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {mailboxMsg && (
                    <p className={`text-xs ${mailboxMsg.ok ? "text-success" : "text-warning"}`} data-testid="mailbox-feedback">
                      {mailboxMsg.ok ? "✓" : "!"} {mailboxMsg.text}
                    </p>
                  )}

                  <div className="flex flex-wrap items-end gap-3 border-t border-border/40 pt-3">
                    <div className="min-w-[220px] flex-1">
                      <Label>Send verification email</Label>
                      <Input
                        type="email"
                        value={testEmailTo}
                        onChange={(e) => setTestEmailTo(e.target.value)}
                        placeholder="you@yourdomain.com"
                        data-testid="mailbox-test-to"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={testEmailBusy || !testEmailTo.trim() || !vault?.configured}
                      onClick={() => void sendTestEmail()}
                      data-testid="mailbox-test-send"
                    >
                      <IconSend className="h-3.5 w-3.5" /> {testEmailBusy ? "Sending…" : "Send test email"}
                    </Button>
                    {testEmailMsg && (
                      <span className={`text-xs ${testEmailMsg.ok ? "text-success" : "text-danger"}`} data-testid="mailbox-test-result">
                        {testEmailMsg.ok ? "✓" : "✕"} {testEmailMsg.text}
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Webhooks */}
            <div className="space-y-4 p-5">
              <div>
                <p className="text-sm font-semibold text-fg">Webhooks</p>
                <p className="mt-0.5 text-xs text-fg-muted leading-relaxed">
                  Receive suppressed-execution notifications (with full report HTML). Each URL is retried 3× with backoff.
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[140px] flex-1">
                  <Label>Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Slack" />
                </div>
                <div className="min-w-[200px] flex-[2]">
                  <Label>Webhook URL</Label>
                  <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.slack.com/…" />
                </div>
                <Button onClick={() => void addWebhook()} disabled={busy} className="mb-0.5">
                  <IconPlus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>
              {hookMsg && <p className="text-xs text-fg-muted">{hookMsg}</p>}
              <div className="divide-y divide-border/50 rounded-lg border border-border/50">
                {webhooks.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-fg-muted/60">No webhooks configured yet.</p>
                ) : (
                  webhooks.map((w) => (
                    <div key={w.id} className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-2/30">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-fg">{w.name}</p>
                        <p className="truncate font-mono text-[11px] text-fg-muted/60">{w.url}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        {w.lastDeliveryStatus && (
                          <span
                            className={`rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                              w.lastDeliveryStatus === "success"
                                ? "bg-success/10 text-success border-success/20"
                                : "bg-danger/10 text-danger border-danger/20"
                            }`}
                          >
                            {w.lastDeliveryStatus}
                          </span>
                        )}
                        <Button variant="ghost" size="icon" title="Test" onClick={() => void testWebhook(w.id)}>
                          <IconSend className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Delete" onClick={() => void removeWebhook(w.id)}>
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
    </div>
  );
}
