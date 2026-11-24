"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/primitives";
import { parseAdminConsentReturn, hasBootstrapScopes, AUTHORIZE_CALLBACK_PATH } from "@/lib/graph-consent";

type Status = "unknown" | "ok" | "missing" | "pending" | "error";

interface Props {
  /** "full" = Settings card (setup snippet + advanced auto-grant). "compact" = job form. */
  variant?: "full" | "compact";
  /** compact only: the scopes this report needs, for a focused chip list. */
  reportScopes?: string[];
  /** Increment to force a refresh from parent (e.g. after saving vault creds or one-click deploy). */
  refreshKey?: number;
  /** Notify parent after revalidate / grant / OAuth callback updates DB state. */
  onSynced?: () => void;
}

const PROVIDER = "microsoft365";

/**
 * Interactive Microsoft Graph consent with live per-scope verification badges,
 * OAuth popup postMessage handoff, and DB-hydrated scope state.
 */
export function GraphConsent({ variant = "full", reportScopes, refreshKey = 0, onSynced }: Props) {
  const full = variant === "full";
  const [scopes, setScopes] = useState<string[]>([]);
  const [snippet, setSnippet] = useState("");
  const [clientId, setClientId] = useState("");
  const [status, setStatus] = useState<Status>("unknown");
  const [granted, setGranted] = useState<string[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [readable, setReadable] = useState<boolean>(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [grantBusy, setGrantBusy] = useState(false);
  const [bootstrapReady, setBootstrapReady] = useState<boolean | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [copiedUri, setCopiedUri] = useState(false);
  const [copied, setCopied] = useState(false);
  const [redirectUri, setRedirectUri] = useState("");

  useEffect(() => {
    setRedirectUri(`${window.location.origin}${AUTHORIZE_CALLBACK_PATH}`);
  }, []);

  const loadReq = useCallback(async () => {
    try {
      const r = await fetch(`/api/integrations/${PROVIDER}/required-permissions`);
      const b = await r.json();
      if (b.success) {
        setScopes(b.data.scopes ?? []);
        setSnippet(b.data.snippet ?? "");
        setClientId(b.data.clientId ?? "");
      }
    } catch {
      /* ignore transient fetch error on unmount */
    }
  }, []);

  // Hydrate persisted status + granted/missing scopes from DB so reloads preserve state.
  const loadStatus = useCallback(async () => {
    try {
      const [permRes, intRes] = await Promise.all([
        fetch("/api/settings/permissions").then((r) => r.json()).catch(() => null),
        fetch("/api/integrations").then((r) => r.json()).catch(() => null),
      ]);
      if (permRes?.success) {
        setStatus(permRes.data.status === "ok" ? "ok" : permRes.data.status === "error" ? "error" : "missing");
        setMissing(Array.isArray(permRes.data.missing) ? permRes.data.missing : []);
      }
      if (intRes?.success) {
        const m365 = (intRes.data as Array<{ provider: string; config?: Record<string, unknown> }>)
          .find((i) => i.provider === PROVIDER);
        const cfg = m365?.config ?? {};
        const gList = Array.isArray(cfg.grantedScopes) ? (cfg.grantedScopes as string[]) : [];
        const isReadable = Boolean(cfg.permissionsReadable);
        setGranted(gList);
        setReadable(isReadable);
        if (isReadable) setBootstrapReady(hasBootstrapScopes(gList));
      }
    } catch {
      /* keep current UI state */
    }
  }, []);

  const revalidate = useCallback(
    async (opts?: { preserveMsg?: boolean }) => {
      setTesting(true);
      if (!opts?.preserveMsg) setMsg(null);
      try {
        const r = await fetch("/api/vault/test", { method: "POST" });
        const b = await r.json();
        if (!b.success) {
          setStatus("error");
          if (!opts?.preserveMsg) {
            setMsg({ ok: false, text: b.error?.message ?? "Test failed" });
          }
          return;
        }
        const p = b.data.steps.permissions;
        const gList = Array.isArray(p.granted) ? (p.granted as string[]) : [];
        setGranted(gList);
        setReadable(Boolean(p.readable));
        if (b.data.steps.auth?.ok && p.readable) setBootstrapReady(hasBootstrapScopes(gList));
        if (b.data.ok) {
          setStatus("ok");
          setMissing([]);
          if (!opts?.preserveMsg) setMsg({ ok: true, text: "All required permissions granted." });
        } else if (!b.data.steps.auth?.ok) {
          setStatus("error");
          if (!opts?.preserveMsg) {
            setMsg({ ok: false, text: `Auth failed: ${b.data.steps.auth?.error ?? "check credentials"}` });
          }
        } else if (!p.readable) {
          setStatus("pending");
          setMissing(p.missing ?? []);
          if (!opts?.preserveMsg) {
            setMsg({ ok: false, text: p.error ?? "Consent pending — can't read grants yet. Grant admin consent, then Re-validate." });
          }
        } else {
          setStatus("missing");
          setMissing(p.missing ?? []);
          if (!opts?.preserveMsg) {
            setMsg({ ok: false, text: `Missing: ${(p.missing ?? []).join(", ") || "none"}` });
          }
        }
        onSynced?.();
      } catch (e) {
        setStatus("error");
        if (!opts?.preserveMsg) setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      } finally {
        setTesting(false);
      }
    },
    [onSynced],
  );

  useEffect(() => {
    void loadReq();
    void loadStatus();
  }, [loadReq, loadStatus, refreshKey]);

  // Listen for OAuth popup completion postMessage so parent tab updates automatically.
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const d = ev.data as { type?: string; authorized?: string; partial?: string; reason?: string } | null;
      if (!d || d.type !== "argus-oauth-complete") return;
      if (d.authorized === "ok") {
        setBanner({
          ok: !d.partial,
          text: d.partial
            ? `Authorized, but still missing: ${d.partial}.`
            : "Authorized — permissions appended + granted. Re-testing…",
        });
        void revalidate();
      } else {
        setBanner({ ok: false, text: `Authorize failed: ${d.reason ?? "unknown error"}` });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [revalidate]);

  // Handle direct redirect returns (when not opened inside a popup).
  useEffect(() => {
    if (!full) return;
    const sp = new URLSearchParams(window.location.search);
    const authorized = sp.get("authorized");
    if (authorized) {
      if (authorized === "ok") {
        const partial = sp.get("partial");
        setBanner({
          ok: !partial,
          text: partial ? `Authorized, but still missing: ${partial}.` : "Authorized — permissions appended + granted. Re-testing…",
        });
        void revalidate();
      } else {
        setBanner({ ok: false, text: `Authorize failed: ${sp.get("reason") ?? "unknown error"}` });
      }
      window.history.replaceState(null, "", window.location.pathname);
      return;
    }
    const ret = parseAdminConsentReturn(sp);
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

  async function openAuthorize() {
    setMsg(null);
    try {
      const r = await fetch(`/api/integrations/${PROVIDER}/authorize`);
      const b = await r.json();
      if (!b.success) {
        setMsg({ ok: false, text: b.error?.message ?? "Could not start authorization" });
        return;
      }
      const w = window.open(b.data.url, "argus-authorize", "width=680,height=820");
      if (!w) {
        setMsg({ ok: false, text: "Popup was blocked by your browser — allow popups for this site and retry." });
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function openConsent() {
    setMsg(null);
    try {
      const r = await fetch(`/api/integrations/${PROVIDER}/consent-url`);
      const b = await r.json();
      if (!b.success) {
        setMsg({ ok: false, text: b.error?.message ?? "Could not build consent URL" });
        return;
      }
      const w = window.open(b.data.url, "argus-consent", "width=640,height=760");
      if (!w) {
        setMsg({ ok: false, text: "Popup was blocked by your browser — allow popups and retry." });
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function grant() {
    setGrantBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/integrations/${PROVIDER}/grant`, { method: "POST" });
      const b = await r.json();
      if (b.success) {
        const still: string[] = b.data.stillMissing ?? [];
        const manifestNote = b.data.manifestError ? ` (${b.data.manifestError})` : "";
        setMsg({
          ok: still.length === 0,
          text:
            still.length === 0
              ? `Granted all required permissions.${manifestNote}`
              : `Granted ${b.data.granted?.join(", ") || "none"}; still missing: ${still.join(", ")}${manifestNote}`,
        });
      } else {
        setMsg({ ok: false, text: b.error?.message ?? "Grant failed" });
      }
      await revalidate({ preserveMsg: true });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setGrantBusy(false);
    }
  }

  function copyText(value: string, which: "uri" | "snippet") {
    void navigator.clipboard.writeText(value).then(() => {
      if (which === "uri") {
        setCopiedUri(true);
        setTimeout(() => setCopiedUri(false), 1500);
      } else {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    });
  }

  // Direct link to Authentication blade where Redirect URI is registered.
  const portalAuthUrl = clientId
    ? `https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/Authentication/appId/${clientId}`
    : "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade";
  const chips = (reportScopes && reportScopes.length ? [...new Set([...reportScopes, "Mail.Send"])] : scopes).sort();
  const grantedSet = new Set(granted);
  const missingSet = new Set(missing);

  const scopeTone = (s: string) => {
    if (status === "ok" || (readable && grantedSet.has(s))) {
      return { cls: "border-success/30 bg-success/10 text-success", mark: "✓ " };
    }
    if (readable && missingSet.has(s)) {
      return { cls: "border-warning/40 bg-warning/10 text-warning", mark: "! " };
    }
    return { cls: "border-border/60 bg-surface text-fg-muted", mark: "" };
  };

  const Result = msg && (
    <p className={`mt-2 text-[11px] leading-relaxed ${msg.ok ? "text-success" : status === "pending" ? "text-info" : "text-warning"}`} data-testid="consent-result">
      {msg.ok ? "✓ " : status === "pending" ? "… " : "⚠ "}{msg.text}
    </p>
  );

  // ── Compact (job form) ─────────────────────────────────────────────────────
  if (!full) {
    if (status === "ok") {
      return (
        <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="graph-consent-compact">
          <span className="text-[11px] font-medium text-success" data-testid="consent-result">✓ All required permissions granted.</span>
          <button type="button" disabled={testing} onClick={() => void revalidate()} className="text-[11px] text-fg-muted underline-offset-2 hover:text-fg hover:underline" data-testid="recheck-permissions">
            {testing ? "Checking…" : "Re-check"}
          </button>
        </div>
      );
    }
    return (
      <div className="mt-3 space-y-2" data-testid="graph-consent-compact">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="primary" size="sm" onClick={() => void openAuthorize()} data-testid="authorize">
            Authorize
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={testing} onClick={() => void revalidate()} data-testid="recheck-permissions">
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
        <div className={`rounded-lg border p-3 text-xs ${banner.ok ? "border-success/25 bg-success/5 text-success" : "border-danger/25 bg-danger/5 text-danger"}`} data-testid="consent-banner">
          {banner.ok ? "✓ " : "✕ "}{banner.text}
        </div>
      )}

      <p className="text-xs text-fg-muted leading-relaxed">
        {status === "ok"
          ? "All required Microsoft Graph permissions are verified. Use Authorize only if future reports add scopes."
          : "Authorize opens Microsoft admin consent to declare and grant required scopes, then verifies them live."}
      </p>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="required-scopes">
          {chips.map((s) => {
            const t = scopeTone(s);
            return (
              <span key={s} className={`rounded-md border px-2 py-0.5 font-mono text-[10px] ${t.cls}`}>
                {t.mark}{s}
              </span>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="primary" size="sm" onClick={() => void openAuthorize()} data-testid="authorize">
          Authorize
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={testing} onClick={() => void revalidate()} data-testid="revalidate-permissions">
          {testing ? "Checking…" : "Re-validate"}
        </Button>
      </div>
      {Result}

      {/* One-time setup: declare the permissions on the app */}
      <div className="border-t border-border/50 pt-3">
        <button type="button" onClick={() => setShowSetup((s) => !s)} className="flex w-full items-center justify-between text-left text-xs font-semibold text-fg" data-testid="toggle-setup">
          <span>One-time setup — redirect URI &amp; PowerShell alternative</span>
          <span className="text-fg-muted">{showSetup ? "−" : "+"}</span>
        </button>
        {showSetup && (
          <div className="mt-3 space-y-3">
            <div>
              <p className="text-[11px] font-semibold text-fg">1 · Register this redirect URI on the app (Authentication → Web)</p>
              <p className="mt-1 text-[11px] text-fg-muted">
                Required once for delegated <span className="font-medium text-fg">Authorize</span> sign-in. Open{" "}
                <a href={portalAuthUrl} target="_blank" rel="noopener" className="underline hover:text-fg">Entra Authentication blade</a>.
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="flex-1 break-all rounded-md bg-sidebar-bg px-2.5 py-1.5 font-mono text-[10px] text-sidebar-fg" data-testid="redirect-uri">
                  {redirectUri || AUTHORIZE_CALLBACK_PATH}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copyText(redirectUri || AUTHORIZE_CALLBACK_PATH, "uri")}
                >
                  {copiedUri ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-fg">Alternative · run this PowerShell snippet once</p>
              <p className="mt-1 text-[11px] text-fg-muted leading-relaxed">
                As Global Admin, this declares and grants every scope directly in your own session.
              </p>
              <div className="relative mt-1.5">
                <pre className="max-h-56 overflow-auto rounded-md bg-sidebar-bg p-3 font-mono text-[10px] leading-relaxed text-sidebar-fg" data-testid="consent-snippet">{snippet}</pre>
                <Button type="button" variant="secondary" size="sm" className="absolute right-2 top-2" onClick={() => copyText(snippet, "snippet")} data-testid="copy-snippet">
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
            <p className="text-[11px] text-fg-muted">
              Already declared permissions on the app?{" "}
              <button type="button" onClick={() => void openConsent()} className="underline hover:text-fg" data-testid="grant-admin-consent">
                Grant admin consent
              </button>.
            </p>
          </div>
        )}
      </div>

      {/* Advanced: let Argus grant programmatically */}
      <div className="border-t border-border/50 pt-3">
        <button type="button" onClick={() => setShowAdvanced((s) => !s)} className="flex w-full items-center justify-between text-left text-xs font-semibold text-fg" data-testid="toggle-advanced">
          <span>Advanced — self-service permission grant</span>
          <span className="text-fg-muted">{showAdvanced ? "−" : "+"}</span>
        </button>
        {showAdvanced && (
          <div className="mt-3 space-y-2">
            <p className="text-[11px] text-fg-muted leading-relaxed">
              Argus can grant missing scopes itself once bootstrap scopes (<code className="font-mono">Application.ReadWrite.All</code> + <code className="font-mono">AppRoleAssignment.ReadWrite.All</code>) are consented.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={grantBusy || bootstrapReady !== true}
              onClick={() => void grant()}
              data-testid="grant-permissions"
            >
              {grantBusy ? "Granting…" : "Grant missing permissions"}
            </Button>
            {bootstrapReady !== true && (
              <p className="text-[11px] text-fg-muted/70">
                {bootstrapReady === false
                  ? "Locked — bootstrap scopes not detected. Consent them, then Re-validate."
                  : "Run Re-validate to check bootstrap scopes."}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
