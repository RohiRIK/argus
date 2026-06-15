"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/primitives";
import { parseAdminConsentReturn, hasBootstrapScopes } from "@/lib/graph-consent";

type Status = "unknown" | "ok" | "missing" | "pending" | "error";

interface Props {
  /** "full" = Settings card (setup snippet + advanced auto-grant). "compact" = job form. */
  variant?: "full" | "compact";
  /** compact only: the scopes this report needs, for a focused chip list. */
  reportScopes?: string[];
}

const PROVIDER = "microsoft365";

/**
 * Interactive Microsoft Graph consent. Secure default: one "Grant admin consent"
 * click opens the Microsoft admin-consent popup; the admin approves with their own
 * account. A guided one-time setup (PowerShell snippet / portal link) declares the
 * scopes. Advanced (full variant): let Argus grant programmatically.
 */
export function GraphConsent({ variant = "full", reportScopes }: Props) {
  const full = variant === "full";
  const [scopes, setScopes] = useState<string[]>([]);
  const [snippet, setSnippet] = useState("");
  const [clientId, setClientId] = useState("");
  const [status, setStatus] = useState<Status>("unknown");
  const [missing, setMissing] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [grantBusy, setGrantBusy] = useState(false);
  const [bootstrapReady, setBootstrapReady] = useState<boolean | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadReq = useCallback(async () => {
    const r = await fetch(`/api/integrations/${PROVIDER}/required-permissions`);
    const b = await r.json();
    if (b.success) {
      setScopes(b.data.scopes ?? []);
      setSnippet(b.data.snippet ?? "");
      setClientId(b.data.clientId ?? "");
    }
  }, []);

  const revalidate = useCallback(async () => {
    setTesting(true);
    setMsg(null);
    try {
      const r = await fetch("/api/vault/test", { method: "POST" });
      const b = await r.json();
      if (!b.success) {
        setStatus("error");
        setMsg({ ok: false, text: b.error?.message ?? "Test failed" });
        return;
      }
      const p = b.data.steps.permissions;
      if (b.data.steps.auth?.ok && Array.isArray(p.granted)) setBootstrapReady(hasBootstrapScopes(p.granted));
      if (b.data.ok) {
        setStatus("ok");
        setMissing([]);
        setMsg({ ok: true, text: "All required permissions granted." });
      } else if (!b.data.steps.auth?.ok) {
        setStatus("error");
        setMsg({ ok: false, text: `Auth failed: ${b.data.steps.auth?.error ?? "check credentials"}` });
      } else if (!p.readable) {
        setStatus("pending");
        setMsg({ ok: false, text: p.error ?? "Consent pending — can't read grants yet. Grant admin consent, then Re-validate." });
      } else {
        setStatus("missing");
        setMissing(p.missing ?? []);
        setMsg({ ok: false, text: `Missing: ${(p.missing ?? []).join(", ") || "none"}` });
      }
    } catch (e) {
      setStatus("error");
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }, []);

  useEffect(() => {
    void loadReq();
  }, [loadReq]);

  // Trust the admin-consent redirect (only the full/Settings surface owns the redirect URI).
  useEffect(() => {
    if (!full) return;
    const ret = parseAdminConsentReturn(new URLSearchParams(window.location.search));
    if (ret.status === "none") return;
    if (ret.status === "success") {
      setBanner({ ok: true, text: `Admin consent authorized${ret.tenant ? ` for tenant ${ret.tenant}` : ""}. Re-testing…` });
      setBootstrapReady(true);
      void revalidate();
    } else {
      setBanner({ ok: false, text: `Admin consent failed: ${ret.errorDescription ?? ret.error}` });
    }
    window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full]);

  async function openConsent() {
    const r = await fetch(`/api/integrations/${PROVIDER}/consent-url`);
    const b = await r.json();
    if (b.success) window.open(b.data.url, "argus-consent", "width=640,height=760");
    else setMsg({ ok: false, text: b.error?.message ?? "Could not build consent URL" });
  }

  async function grant() {
    setGrantBusy(true);
    const r = await fetch(`/api/integrations/${PROVIDER}/grant`, { method: "POST" });
    const b = await r.json();
    if (b.success) {
      const still: string[] = b.data.stillMissing ?? [];
      setMsg({
        ok: still.length === 0,
        text: still.length === 0 ? "Granted all required permissions." : `Granted ${b.data.granted?.join(", ") || "none"}; still missing: ${still.join(", ")}`,
      });
    } else {
      setMsg({ ok: false, text: b.error?.message ?? "Grant failed" });
    }
    await revalidate();
    setGrantBusy(false);
  }

  function copySnippet() {
    void navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const portalUrl = clientId
    ? `https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/CallAnAPI/appId/${clientId}`
    : "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade";
  const chips = (reportScopes && reportScopes.length ? [...new Set([...reportScopes, "Mail.Send"])] : scopes).sort();

  const Result = msg && (
    <p className={`mt-2 text-[11px] leading-relaxed ${msg.ok ? "text-success" : status === "pending" ? "text-info" : "text-warning"}`} data-testid="consent-result">
      {msg.ok ? "✓ " : status === "pending" ? "… " : "⚠ "}{msg.text}
    </p>
  );

  // ── Compact (job form) ─────────────────────────────────────────────────────
  if (!full) {
    return (
      <div className="mt-3 space-y-2" data-testid="graph-consent-compact">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="primary" size="sm" onClick={openConsent} data-testid="grant-admin-consent">
            Grant admin consent
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={testing} onClick={revalidate} data-testid="recheck-permissions">
            {testing ? "Checking…" : "Re-check"}
          </Button>
          <a href="/settings/integrations" className="text-[11px] text-fg-muted underline-offset-2 hover:text-fg hover:underline">
            Full setup in Settings →
          </a>
        </div>
        {Result}
      </div>
    );
  }

  // ── Full (Settings card) ───────────────────────────────────────────────────
  return (
    <div className="space-y-3" data-testid="graph-consent-full">
      {banner && (
        <div className={`rounded-lg border p-3 text-xs ${banner.ok ? "border-success/20 bg-success/5 text-success" : "border-danger/20 bg-danger/5 text-danger"}`} data-testid="consent-banner">
          {banner.ok ? "✓ " : "✕ "}{banner.text}
        </div>
      )}

      <p className="text-xs text-fg-muted/80 leading-relaxed">
        Argus needs these <span className="font-medium">application</span> permissions. Click <span className="font-medium">Grant admin consent</span> to approve them with your own admin account, then <span className="font-medium">Re-validate</span>.
      </p>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="required-scopes">
          {chips.map((s) => (
            <span key={s} className="rounded-md border border-border/60 bg-surface px-2 py-0.5 font-mono text-[10px] text-fg">{s}</span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="primary" size="sm" onClick={openConsent} data-testid="grant-admin-consent">
          Grant admin consent
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={testing} onClick={revalidate} data-testid="revalidate-permissions">
          {testing ? "Checking…" : "Re-validate"}
        </Button>
      </div>
      {Result}

      {/* One-time setup: declare the permissions on the app */}
      <div className="rounded-lg border border-border/40 bg-surface-2/20 p-3">
        <button type="button" onClick={() => setShowSetup((s) => !s)} className="flex w-full items-center justify-between text-left text-xs font-semibold text-fg" data-testid="toggle-setup">
          <span>One-time setup — declare permissions on the app</span>
          <span className="text-fg-muted">{showSetup ? "−" : "+"}</span>
        </button>
        {showSetup && (
          <div className="mt-2 space-y-2">
            <p className="text-[11px] text-fg-muted/70 leading-relaxed">
              Admin consent only grants permissions that are <span className="font-medium">declared</span> on the app. Run this once as a Global Admin (grants every scope directly in your own session — Argus needs no elevated rights), or add them in the{" "}
              <a href={portalUrl} target="_blank" rel="noopener" className="underline hover:text-fg">Entra portal</a>.
            </p>
            <div className="relative">
              <pre className="max-h-56 overflow-auto rounded-md bg-[hsl(222_47%_3%)] p-3 font-mono text-[10px] leading-relaxed text-fg-muted" data-testid="consent-snippet">{snippet}</pre>
              <Button type="button" variant="ghost" size="sm" className="absolute right-2 top-2" onClick={copySnippet} data-testid="copy-snippet">
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Advanced: let Argus grant programmatically (needs Tier-0 bootstrap scopes) */}
      <div className="rounded-lg border border-border/40 bg-surface-2/20 p-3">
        <button type="button" onClick={() => setShowAdvanced((s) => !s)} className="flex w-full items-center justify-between text-left text-xs font-semibold text-fg" data-testid="toggle-advanced">
          <span>Advanced — let Argus grant automatically</span>
          <span className="text-fg-muted">{showAdvanced ? "−" : "+"}</span>
        </button>
        {showAdvanced && (
          <div className="mt-2 space-y-2">
            <p className="text-[11px] text-fg-muted/70 leading-relaxed">
              Argus can grant the missing scopes itself, but only after you consent the two privileged bootstrap scopes
              (<code className="font-mono">Application.ReadWrite.All</code> + <code className="font-mono">AppRoleAssignment.ReadWrite.All</code>) via <span className="font-medium">Grant admin consent</span> above. These are powerful — prefer the one-time setup unless you specifically want self-service grants.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={grantBusy || bootstrapReady !== true}
              onClick={grant}
              data-testid="grant-permissions"
            >
              {grantBusy ? "Granting…" : "Grant missing permissions"}
            </Button>
            {bootstrapReady !== true && (
              <p className="text-[11px] text-fg-muted/60">
                {bootstrapReady === false
                  ? "Locked — bootstrap scopes not detected. Grant admin consent for them, then Re-validate."
                  : "Run Re-validate after consenting the bootstrap scopes to unlock this."}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
