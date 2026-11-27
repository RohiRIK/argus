"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, LinkButton } from "@/components/ui/primitives";

export interface OnboardingState {
  masterKeyPresent: boolean;
  vaultConfigured: boolean;
  integrationStatus: "connected" | "disconnected" | "error";
  tenantDisplayName?: string;
  primaryDomain?: string;
  grantedCount: number;
  requiredCount: number;
  hasMailSend: boolean;
  jobsCount: number;
}

export function OnboardingChecklist({ state }: { state: OnboardingState }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const complete =
    state.masterKeyPresent &&
    state.vaultConfigured &&
    state.integrationStatus === "connected" &&
    state.jobsCount > 0;

  if (complete) return null;

  async function deployStarter() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/onboarding/starter-pack", { method: "POST" });
      const body = await res.json();
      if (body.success) {
        setMsg(`Created ${body.data.createdCount} baseline job(s).` + (body.data.pausedCount ? ` ${body.data.pausedCount} paused until they have recipients — see Settings → Recipients.` : ""));
        router.refresh();
      } else {
        setMsg(body.error?.message ?? "Failed to deploy starter pack");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const steps = [
    {
      id: "key",
      label: "1. Master Key",
      ok: state.masterKeyPresent,
      detail: state.masterKeyPresent ? "ARGUS_MASTER_KEY loaded" : "Set ARGUS_MASTER_KEY (64 hex chars)",
    },
    {
      id: "tenant",
      label: "2. Microsoft 365 Tenant",
      ok: state.vaultConfigured && state.integrationStatus === "connected",
      detail: state.tenantDisplayName
        ? `${state.tenantDisplayName}${state.primaryDomain ? ` (${state.primaryDomain})` : ""}`
        : state.vaultConfigured
          ? "Credentials stored — run Test Connection"
          : "Deploy with one click in Settings",
    },
    {
      id: "perms",
      label: "3. Graph Permissions",
      ok: state.grantedCount > 0 && state.hasMailSend,
      detail:
        state.grantedCount > 0
          ? `${state.grantedCount}/${state.requiredCount} scopes${state.hasMailSend ? " · Mail.Send ready" : " · Mail.Send missing"}`
          : "Pending admin consent",
    },
    {
      id: "jobs",
      label: "4. Baseline Reports",
      ok: state.jobsCount > 0,
      detail: state.jobsCount > 0 ? `${state.jobsCount} active job(s)` : "Deploy 4 recommended reports or pick from Catalog",
    },
  ];

  return (
    <div className="mb-6 overflow-hidden rounded-lg border border-border/70 bg-surface" data-testid="onboarding-checklist">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 px-5 py-3.5">
        <div>
          <p className="text-sm font-semibold text-fg">Tenant onboarding checklist</p>
          <p className="text-xs text-fg-muted">Complete these steps to connect Microsoft 365 and start delivering reports.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(!state.vaultConfigured || state.integrationStatus !== "connected") && (
            <LinkButton href="/settings/integrations" variant="primary" size="sm">
              Connect Microsoft 365 →
            </LinkButton>
          )}
          {state.jobsCount === 0 && (
            <Button type="button" variant={state.integrationStatus === "connected" ? "primary" : "outline"} size="sm" disabled={busy} onClick={() => void deployStarter()} data-testid="onboarding-starter-pack">
              {busy ? "Deploying…" : "Deploy starter pack"}
            </Button>
          )}
          <LinkButton href="/catalog" variant="outline" size="sm">
            Browse catalog
          </LinkButton>
        </div>
      </div>

      <div className="grid divide-y divide-border/50 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
        {steps.map((s) => (
          <div key={s.id} className="px-4 py-3">
            <div className="flex items-center gap-2">
              <span className={`font-mono text-xs font-semibold ${s.ok ? "text-success" : "text-warning"}`}>
                {s.ok ? "✓" : "○"}
              </span>
              <span className="text-xs font-semibold text-fg">{s.label}</span>
            </div>
            <p className="mt-1 truncate text-[11px] text-fg-muted">{s.detail}</p>
          </div>
        ))}
      </div>

      {msg && <p className="border-t border-border/50 px-5 py-2 text-xs text-fg-muted">{msg}</p>}
    </div>
  );
}
