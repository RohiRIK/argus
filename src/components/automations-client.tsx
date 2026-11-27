"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Badge,
  BadgeCategory,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  LinkButton,
  Select,
} from "@/components/ui/primitives";
import { RelativeTime } from "@/components/ui/relative-time";
import { useToast } from "@/components/ui/toast";
import { WorkloadIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { AutomationAction, AutomationLog, AutomationPolicy } from "@/db/schema";
import type { AutomationRunSummary } from "@/db/dao/automations";
import type {
  AutomationCategory,
  AutomationParamField,
  AutomationRiskLevel,
} from "@/services/automations/types";
import type { PluginIconKey, RecommendedSchedule } from "@/services/reports/types";

export type CatalogAutomationItem = {
  id: string;
  version: string;
  name: string;
  category: AutomationCategory;
  riskLevel: AutomationRiskLevel;
  description: string;
  requiredPermissions: string[];
  recommendedSchedule: RecommendedSchedule;
  recommendedMode: "audit" | "enforce";
  service: string;
  icon: PluginIconKey;
  dataSource: "graph-v1" | "graph-beta";
  tags: string[];
  pairedReportId: string | null;
  paramSchema: AutomationParamField[];
  defaultParams: Record<string, unknown>;
};

export type PolicyWithLatestRun = AutomationPolicy & {
  catalogName: string;
  category: AutomationCategory;
  riskLevel: AutomationRiskLevel;
  icon: PluginIconKey;
  requiredPermissions: string[];
  latestRun: AutomationRunSummary | null;
};

export type AutomationIntegrationInfo = {
  configured: boolean;
  status: string;
  authMode: string | null;
  grantedScopes: string[];
  missingScopes: string[];
  tenantDisplayName: string | null;
  appDisplayName: string | null;
};

export type AutomationsTab = "policies" | "runs";

/** The automation catalog now lives in the unified /catalog, filtered to automations. */
export const AUTOMATION_CATALOG_HREF = "/catalog?type=automation";
type RunDetail = { run: AutomationRunSummary; actions: AutomationAction[]; logs: AutomationLog[] };

const RUN_STATUS_CLS: Record<AutomationRunSummary["status"], string> = {
  success: "bg-success/8 text-success border-success/15",
  drift_detected: "bg-warning/8 text-warning border-warning/15",
  warning: "bg-warning/8 text-warning border-warning/15",
  failed: "bg-danger/8 text-danger border-danger/15",
  halted: "bg-danger/8 text-danger border-danger/15",
  interrupted: "bg-warning/8 text-warning border-warning/15",
};
export const RISK_CLS: Record<AutomationRiskLevel, string> = {
  low: "text-success border-success/20",
  medium: "text-warning border-warning/20",
  high: "text-danger border-danger/20",
};

export async function automationApi<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: { message?: string } };
  if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  return body.data as T;
}

function RunStatus({ status }: { status: AutomationRunSummary["status"] }) {
  return (
    <span className={cn("inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase", RUN_STATUS_CLS[status])}>
      {status.replace("_", " ")}
    </span>
  );
}

function ModeBadge({ mode }: { mode: string }) {
  return (
    <Badge className={mode === "enforce" ? "border-danger/30 text-danger" : "border-info/30 text-info"}>
      {mode === "enforce" ? "Enforce" : mode === "rollback" ? "Rollback" : "Audit"}
    </Badge>
  );
}

export function AutomationsClient({
  tab,
  initialPolicies: policies,
  initialRecentRuns: runs,
  integration,
}: {
  tab: AutomationsTab;
  initialPolicies: PolicyWithLatestRun[];
  initialRecentRuns: AutomationRunSummary[];
  integration: AutomationIntegrationInfo;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(key: string, fn: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await fn();
      toast.push(done, "success");
      router.refresh();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "danger");
    } finally {
      setBusy(null);
    }
  }

  const policyNames = useMemo(() => new Map(policies.map((p) => [p.id, p.name])), [policies]);

  return (
    <div className="space-y-5" data-testid="automations-page">
      <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Automations sections">
        <div className="flex items-center gap-1.5">
          {(
            [
              { key: "policies", href: "/automations", label: `Policies (${policies.length})` },
              { key: "runs", href: "/automations/runs", label: "Runs" },
            ] as const
          ).map((t) => (
            <Link
              key={t.key}
              href={t.href}
              data-testid={`automations-tab-${t.key}`}
              aria-current={tab === t.key ? "page" : undefined}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                tab === t.key
                  ? "border-primary/45 bg-primary/12 text-fg"
                  : "border-border/60 text-fg-muted hover:text-fg",
              )}
            >
              {t.label}
            </Link>
          ))}
        </div>
        <LinkButton href={AUTOMATION_CATALOG_HREF} size="sm" variant="secondary" data-testid="automations-catalog-link">
          Browse automations in Catalog →
        </LinkButton>
      </nav>

      {!integration.configured || integration.missingScopes.length > 0 ? (
        <Card className="border-warning/30">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="text-sm">
              <p className="font-semibold text-fg">
                {integration.configured ? "Automation app is missing permissions" : "Automation integration not connected"}
              </p>
              <p className="mt-0.5 text-xs text-fg-muted">
                {integration.configured
                  ? `Missing: ${integration.missingScopes.join(", ")}`
                  : "Automations use a separate read-write Entra app. Audit runs need it too."}
              </p>
            </div>
            <LinkButton href="/settings/integrations" size="sm">Set up integration</LinkButton>
          </CardContent>
        </Card>
      ) : (
        <p className="text-xs text-fg-muted">
          Connected as <span className="text-fg">{integration.appDisplayName ?? "Argus Automation"}</span>
          {integration.tenantDisplayName ? ` · ${integration.tenantDisplayName}` : ""}
        </p>
      )}

      {tab === "policies" && (
        <PoliciesTab policies={policies} busy={busy} act={act} onBrowse={() => router.push(AUTOMATION_CATALOG_HREF)} />
      )}
      {tab === "runs" && <RunsTab runs={runs} policyNames={policyNames} act={act} />}
    </div>
  );
}

type ActFn = (key: string, fn: () => Promise<unknown>, done: string) => Promise<void>;

function PoliciesTab({
  policies,
  busy,
  act,
  onBrowse,
}: {
  policies: PolicyWithLatestRun[];
  busy: string | null;
  act: ActFn;
  onBrowse: () => void;
}) {
  const [armed, setArmed] = useState<string | null>(null);
  if (policies.length === 0) {
    return (
      <EmptyState
        title="No automation policies yet"
        hint="Pick an automation from the catalog. New policies start in Audit mode and change nothing."
        action={<Button onClick={onBrowse}>Browse catalog</Button>}
      />
    );
  }
  const run = (p: PolicyWithLatestRun, mode: "audit" | "enforce") =>
    act(
      `${mode}-${p.id}`,
      () => automationApi(`/api/automations/${p.id}/run`, { method: "POST", body: JSON.stringify({ mode }) }),
      mode === "audit" ? "Audit finished" : "Enforce run finished",
    );

  return (
    <div className="grid gap-3">
      {policies.map((p) => (
        <Card key={p.id} data-testid={`policy-${p.id}`}>
          <CardContent className="flex flex-wrap items-center gap-4 py-4">
            <WorkloadIcon icon={p.icon} className="h-8 w-8 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-semibold text-fg">{p.name}</span>
                <ModeBadge mode={p.mode} />
                <BadgeCategory category={p.category} />
                {p.status === "disabled" && <Badge>Disabled</Badge>}
              </div>
              <p className="mt-1 text-xs text-fg-muted">
                {p.catalogName} · {p.scheduleType === "manual" ? "manual" : p.schedulePreset ?? p.cronExpression}
                {" · "}max {p.maxActionsPerRun} changes/run
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-fg-muted">
              {p.latestRun ? (
                <>
                  <RunStatus status={p.latestRun.status} />
                  <RelativeTime iso={p.latestRun.startedAt} />
                </>
              ) : (
                "never run"
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => run(p, "audit")}>
                {busy === `audit-${p.id}` ? "Running…" : "Audit"}
              </Button>
              <Button
                size="sm"
                variant={armed === p.id ? "danger" : "outline"}
                disabled={busy !== null}
                onClick={() => {
                  if (armed !== p.id) return setArmed(p.id);
                  setArmed(null);
                  void run(p, "enforce");
                }}
                onBlur={() => setArmed(null)}
              >
                {busy === `enforce-${p.id}` ? "Enforcing…" : armed === p.id ? "Confirm enforce" : "Enforce"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() =>
                  act(
                    `toggle-${p.id}`,
                    () =>
                      automationApi(`/api/automations/${p.id}`, {
                        method: "PUT",
                        body: JSON.stringify({ status: p.status === "active" ? "disabled" : "active" }),
                      }),
                    p.status === "active" ? "Policy disabled" : "Policy enabled",
                  )
                }
              >
                {p.status === "active" ? "Disable" : "Enable"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-danger"
                disabled={busy !== null}
                onClick={() => act(`del-${p.id}`, () => automationApi(`/api/automations/${p.id}`, { method: "DELETE" }), "Policy deleted")}
              >
                Delete
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ProvisionButton({
  automationType,
  field,
  value,
  onChange,
}: {
  automationType: string;
  field: AutomationParamField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!field.provision) return null;
  const { displayName } = field.provision;

  async function create() {
    setBusy(true);
    try {
      const g = await automationApi<{ id: string; displayName: string; created: boolean }>("/api/automations/provision", {
        method: "POST",
        body: JSON.stringify({ automationType, paramKey: field.key }),
      });
      const list = Array.isArray(value) ? (value as string[]) : [];
      onChange(field.type === "string_list" ? (list.includes(g.id) ? list : [...list, g.id]) : g.id);
      toast.push(`${g.created ? "Created" : "Using existing"} group "${g.displayName}"`, "success");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type="button" size="sm" variant="outline" className="mt-1.5" disabled={busy} onClick={() => void create()}>
      {busy ? "Creating…" : `Create group "${displayName}"`}
    </Button>
  );
}

function ParamInput({
  field,
  value,
  onChange,
}: {
  field: AutomationParamField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (field.type === "boolean") {
    return <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
  }
  if (field.type === "select") {
    return (
      <Select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
        {(field.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </Select>
    );
  }
  if (field.type === "number") {
    return <Input type="number" value={String(value ?? "")} onChange={(e) => onChange(Number(e.target.value))} />;
  }
  if (field.type === "string_list") {
    return (
      <Input
        placeholder={field.placeholder ?? "comma separated"}
        value={Array.isArray(value) ? value.join(", ") : ""}
        onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
      />
    );
  }
  return <Input placeholder={field.placeholder} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
}

export function CreatePolicyDialog({
  item,
  recipientGroups,
  onClose,
  onCreate,
}: {
  item: CatalogAutomationItem;
  recipientGroups: { id: string; name: string }[];
  onClose: () => void;
  onCreate: (body: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(item.name);
  const [schedule, setSchedule] = useState<string>(item.recommendedSchedule);
  const [notifyOn, setNotifyOn] = useState("changes_only");
  const [maxActions, setMaxActions] = useState(25);
  const [groupId, setGroupId] = useState("");
  const [params, setParams] = useState<Record<string, unknown>>(item.defaultParams);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="New automation policy">
        <CardHeader>
          <CardTitle>New policy · {item.name}</CardTitle>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="rounded-md border border-info/25 bg-info/8 px-3 py-2 text-xs text-info">
            Starts in Audit mode: it reports what it would change and changes nothing. Run Enforce from the policy when ready.
          </p>
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Schedule</Label>
              <Select value={schedule} onChange={(e) => setSchedule(e.target.value)}>
                <option value="manual">Manual only</option>
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="business_days">Business days</option>
              </Select>
            </div>
            <div>
              <Label>Max changes per run</Label>
              <Input type="number" min={1} max={500} value={maxActions} onChange={(e) => setMaxActions(Number(e.target.value))} />
            </div>
            <div>
              <Label>Notify</Label>
              <Select value={notifyOn} onChange={(e) => setNotifyOn(e.target.value)}>
                <option value="changes_only">On changes</option>
                <option value="failures_only">On failures</option>
                <option value="always">Always</option>
              </Select>
            </div>
            <div>
              <Label>Recipient group</Label>
              <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">Global recipients</option>
                {recipientGroups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </Select>
            </div>
          </div>
          {item.paramSchema.map((f) => (
            <div key={f.key}>
              <Label>
                {f.label}
                {f.required && <span className="text-danger"> *</span>}
              </Label>
              <ParamInput field={f} value={params[f.key]} onChange={(v) => setParams({ ...params, [f.key]: v })} />
              <ProvisionButton
                automationType={item.id}
                field={f}
                value={params[f.key]}
                onChange={(v) => setParams((prev) => ({ ...prev, [f.key]: v }))}
              />
              <p className="mt-1 text-[11px] text-fg-muted">{f.description}</p>
            </div>
          ))}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              disabled={!name.trim()}
              onClick={() =>
                onCreate({
                  name: name.trim(),
                  description: item.description,
                  automationType: item.id,
                  mode: "audit",
                  params,
                  scheduleType: schedule === "manual" ? "manual" : "preset",
                  schedulePreset: schedule === "manual" ? null : schedule,
                  notifyOn,
                  maxActionsPerRun: maxActions,
                  recipientGroupIds: groupId ? [groupId] : [],
                  tags: item.tags.slice(0, 5),
                })
              }
            >
              Create policy
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RunsTab({
  runs,
  policyNames,
  act,
}: {
  runs: AutomationRunSummary[];
  policyNames: Map<string, string>;
  act: ActFn;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);

  async function toggle(id: string) {
    if (openId === id) return setOpenId(null);
    setOpenId(id);
    setDetail(null);
    setDetail(await automationApi<RunDetail>(`/api/automations/runs/${id}`).catch(() => null));
  }

  if (runs.length === 0) return <EmptyState title="No runs yet" hint="Run a policy in Audit mode to see what it would change." />;

  return (
    <Card>
      <div className="divide-y divide-border/50">
        {runs.map((r) => (
          <div key={r.id}>
            <button
              type="button"
              onClick={() => void toggle(r.id)}
              className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left text-xs hover:bg-surface-2/50"
            >
              <RunStatus status={r.status} />
              <ModeBadge mode={r.mode} />
              <span className="flex-1 font-medium text-fg">{policyNames.get(r.policyId) ?? r.policyId}</span>
              <span className="text-fg-muted">
                {r.evaluatedCount} checked · {r.plannedCount} planned · {r.appliedCount} applied
                {r.failedCount ? ` · ${r.failedCount} failed` : ""}
              </span>
              <RelativeTime iso={r.startedAt} className="text-fg-muted" />
            </button>
            {openId === r.id && (
              <div className="space-y-3 bg-surface-2/30 px-5 py-4 text-xs">
                {r.summaryText && <p className="text-fg">{r.summaryText}</p>}
                {r.errorMessage && <p className="text-danger">{r.errorMessage}</p>}
                {!detail ? (
                  <p className="text-fg-muted">Loading…</p>
                ) : detail.actions.length === 0 ? (
                  <p className="text-fg-muted">No changes planned. Tenant matches the policy.</p>
                ) : (
                  detail.actions.map((a) => (
                    <details key={a.id} className="rounded-md border border-border/50 bg-surface px-3 py-2">
                      <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                        <Badge>{a.status.replace("_", " ")}</Badge>
                        <span className="font-medium text-fg">{a.targetLabel}</span>
                        <span className="text-fg-muted">
                          {a.actionType} · {a.reason}
                        </span>
                        {a.status === "applied" && a.rollbackPayload && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="ml-auto h-6"
                            onClick={(e) => {
                              e.preventDefault();
                              void act(
                                `rb-${a.id}`,
                                () => automationApi(`/api/automations/actions/${a.id}/rollback`, { method: "POST" }),
                                "Change rolled back",
                              ).then(() => toggle(r.id));
                            }}
                          >
                            Roll back
                          </Button>
                        )}
                      </summary>
                      {a.errorMessage && <p className="mt-2 text-danger">{a.errorMessage}</p>}
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <pre className="overflow-x-auto rounded bg-surface-2 p-2 text-[10px]">{JSON.stringify(a.beforeState, null, 2)}</pre>
                        <pre className="overflow-x-auto rounded bg-surface-2 p-2 text-[10px]">
                          {a.afterState ? JSON.stringify(a.afterState, null, 2) : "—"}
                        </pre>
                      </div>
                    </details>
                  ))
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
