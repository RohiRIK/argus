"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Textarea,
  Select,
  Label,
  Segmented,
  Skeleton,
} from "@/components/ui/primitives";
import { GraphConsent } from "@/components/graph-consent";
import { PRESET_KEYS, resolveScheduleCron, describeSchedule } from "@/lib/schedule";
import { nextRuns, formatInZone } from "@/lib/cron";

type ConditionMode = "always" | "count_gt" | "count_changed" | "anomaly" | "new_items";
type ScheduleType = "preset" | "cron";

const CONDITIONS: { value: ConditionMode; label: string }[] = [
  { value: "always", label: "Always send" },
  { value: "count_gt", label: "Count exceeds threshold" },
  { value: "count_changed", label: "Count changed since last run" },
  { value: "anomaly", label: "Anomaly detected" },
  { value: "new_items", label: "New items appear" },
];

export interface JobFormValues {
  name: string;
  description: string;
  reportType: string;
  recipients: string; // comma-separated in the UI
  scheduleType: ScheduleType;
  schedulePreset: string;
  cronExpression: string;
  conditionMode: ConditionMode;
  threshold: string;
  templateId: string | null;
  tags: string; // comma-separated in the UI
  status: "active" | "disabled";
}

interface Template {
  id: string;
  name: string;
  reportType: string;
  subject: string;
  htmlBody: string;
  isDefault: boolean;
}

const DEFAULTS: JobFormValues = {
  name: "",
  description: "",
  reportType: "",
  recipients: "",
  scheduleType: "preset",
  schedulePreset: "daily",
  cronExpression: "0 8 * * *",
  conditionMode: "always",
  threshold: "5",
  templateId: null,
  tags: "",
  status: "active",
};

interface JobFormProps {
  /** create → POST /api/jobs · edit → PUT /api/jobs/:id */
  mode: "create" | "edit";
  /** Edit/clone source job id to prefill from (GET /api/jobs/:id). */
  sourceJobId?: string;
  /** Edit target id (PUT). Omit for create/clone. */
  jobId?: string;
  /** Locked report type for create-from-catalog. */
  reportType?: string;
  /** Display name for the report (header). */
  reportName?: string;
  /** Selectable report types when not locked. */
  catalog?: { id: string; name: string }[];
  /** Initial overrides (e.g. from a quick-setup preset). Remount via `key` to apply. */
  initial?: Partial<JobFormValues>;
  /** Append " (copy)" to the prefilled name (clone flow). */
  cloneName?: boolean;
}

function safeNextRuns(cron: string | null, tz: string): Date[] {
  if (!cron) return [];
  try {
    return nextRuns(cron, 5, new Date(), tz);
  } catch {
    return [];
  }
}

export function JobForm({
  mode,
  sourceJobId,
  jobId,
  reportType,
  reportName,
  catalog,
  initial,
  cloneName,
}: JobFormProps) {
  const router = useRouter();
  const [v, setV] = useState<JobFormValues>({
    ...DEFAULTS,
    reportType: reportType ?? catalog?.[0]?.id ?? "",
    name: reportName ?? "",
    ...initial,
  });
  const [templates, setTemplates] = useState<Template[]>([]);
  const [permsByReport, setPermsByReport] = useState<Record<string, string[]>>({});
  const [tz, setTz] = useState("UTC");
  const [advanced, setAdvanced] = useState(false);
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(Boolean(sourceJobId));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = useCallback(
    <K extends keyof JobFormValues>(key: K, value: JobFormValues[K]) =>
      setV((prev) => ({ ...prev, [key]: value })),
    [],
  );

  // Load templates once for the [Advanced] picker.
  useEffect(() => {
    void fetch("/api/templates")
      .then((r) => r.json())
      .then((b) => b.success && setTemplates(b.data));
  }, []);

  // Load catalog metadata so we can show the report's required Graph permissions.
  useEffect(() => {
    void fetch("/api/catalog")
      .then((r) => r.json())
      .then((b) => {
        if (!b.success) return;
        const map: Record<string, string[]> = {};
        for (const r of b.data) map[r.id] = r.requiredPermissions ?? [];
        setPermsByReport(map);
      });
  }, []);

  // Configured timezone so the next-run preview matches when jobs actually fire.
  useEffect(() => {
    void fetch("/api/settings")
      .then((r) => r.json())
      .then((b) => b.success && setTz(b.data.timezone ?? "UTC"));
  }, []);

  // Prefill from a source job (edit or clone).
  useEffect(() => {
    if (!sourceJobId) return;
    let active = true;
    void fetch(`/api/jobs/${sourceJobId}`)
      .then((r) => r.json())
      .then((b) => {
        if (!active || !b.success) return;
        const j = b.data;
        setV({
          name: cloneName ? `${j.name} (copy)` : j.name,
          description: j.description ?? "",
          reportType: j.reportType,
          recipients: (j.recipients ?? []).join(", "),
          scheduleType: j.scheduleType,
          schedulePreset: j.schedulePreset ?? "daily",
          cronExpression: j.cronExpression ?? "0 8 * * *",
          conditionMode: j.conditionalRules?.mode ?? "always",
          threshold: String(j.conditionalRules?.threshold ?? 5),
          templateId: j.templateId ?? null,
          tags: (j.tags ?? []).join(", "),
          status: j.status ?? "active",
        });
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [sourceJobId, cloneName]);

  const cron = useMemo(
    () => resolveScheduleCron(v.scheduleType, v.schedulePreset, v.cronExpression),
    [v.scheduleType, v.schedulePreset, v.cronExpression],
  );
  const runs = useMemo(() => safeNextRuns(cron, tz), [cron, tz]);
  const summary = describeSchedule(v.scheduleType, v.schedulePreset, v.cronExpression);

  const reportTemplates = templates.filter((t) => t.reportType === v.reportType);
  const selectedTemplate = templates.find((t) => t.id === v.templateId) ?? null;
  const requiredPermissions = permsByReport[v.reportType] ?? [];

  // Render a read-only preview of the chosen template.
  useEffect(() => {
    if (!advanced || !selectedTemplate) {
      setPreview("");
      return;
    }
    void fetch("/api/templates/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "html", htmlBody: selectedTemplate.htmlBody, subject: selectedTemplate.subject, reportType: selectedTemplate.reportType }),
    })
      .then((r) => r.json())
      .then((b) => b.success && setPreview(b.data.html ?? ""));
  }, [advanced, selectedTemplate]);

  async function submit() {
    setBusy(true);
    setErr(null);
    const recipients = v.recipients.split(",").map((s) => s.trim()).filter(Boolean);
    const body = {
      name: v.name.trim() || reportName || v.reportType,
      description: v.description.trim(),
      reportType: v.reportType,
      scheduleType: v.scheduleType,
      schedulePreset: v.scheduleType === "preset" ? v.schedulePreset : null,
      cronExpression: v.scheduleType === "cron" ? v.cronExpression.trim() : null,
      templateId: v.templateId,
      recipients,
      conditionalRules:
        v.conditionMode === "count_gt"
          ? { mode: v.conditionMode, threshold: Number(v.threshold) || 0 }
          : { mode: v.conditionMode },
      tags: v.tags.split(",").map((s) => s.trim()).filter(Boolean),
      status: v.status,
    };
    try {
      const res = await fetch(jobId ? `/api/jobs/${jobId}` : "/api/jobs", {
        method: jobId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        router.push("/dashboard");
        router.refresh();
      } else {
        setErr(json.error?.message ?? "Failed to save job");
        setBusy(false);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (loading) return <Skeleton className="h-[640px]" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{mode === "edit" ? "Edit job" : "Configure job"}</CardTitle>
        {reportName && <span className="text-[10px] uppercase tracking-wider text-fg-muted/60">{reportName}</span>}
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Report type — locked when launched from catalog, selectable otherwise */}
        {catalog && !reportType ? (
          <div>
            <Label>Report type</Label>
            <Select value={v.reportType} onChange={(e) => set("reportType", e.target.value)}>
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
        ) : null}

        <div>
          <Label>Job name</Label>
          <Input value={v.name} onChange={(e) => set("name", e.target.value)} placeholder={reportName ?? "Job name"} data-testid="job-name" />
        </div>

        <div>
          <Label>Description <span className="text-fg-muted/50">(optional)</span></Label>
          <Textarea value={v.description} onChange={(e) => set("description", e.target.value)} className="min-h-[60px] font-sans text-sm" />
        </div>

        <div>
          <Label>Recipients <span className="text-fg-muted/50">(comma-separated)</span></Label>
          <Input value={v.recipients} onChange={(e) => set("recipients", e.target.value)} placeholder="admin@contoso.com, soc@contoso.com" data-testid="job-recipients" />
        </div>

        <div>
          <Label>Tags <span className="text-fg-muted/50">(comma-separated, optional)</span></Label>
          <Input value={v.tags} onChange={(e) => set("tags", e.target.value)} placeholder="security, weekly, prod" data-testid="job-tags" />
        </div>

        {/* Required Graph permissions for this report (C1) */}
        {requiredPermissions.length > 0 && (
          <div className="rounded-lg border border-info/25 bg-info/5 p-3.5" data-testid="required-permissions">
            <p className="text-xs font-semibold text-fg">Required Microsoft Graph permissions</p>
            <p className="mt-0.5 text-[11px] text-fg-muted">
              Grant these <span className="font-medium">application</span> permissions to your Entra app registration (with admin consent), plus <code className="font-mono text-fg">Mail.Send</code> so reports can be delivered.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {requiredPermissions.map((p) => (
                <span key={p} className="rounded-md border border-border/60 bg-surface px-2 py-0.5 font-mono text-[10px] text-fg">{p}</span>
              ))}
              <span className="rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 font-mono text-[10px] text-warning">Mail.Send</span>
            </div>
            <GraphConsent variant="compact" reportScopes={requiredPermissions} />
          </div>
        )}

        {/* Schedule */}
        <div className="space-y-2.5 rounded-lg border border-border/50 bg-surface-2/30 p-3.5">
          <div className="flex items-center justify-between">
            <Label className="mb-0">Schedule</Label>
            <Segmented<ScheduleType>
              value={v.scheduleType}
              onChange={(t) => set("scheduleType", t)}
              options={[{ value: "preset", label: "Preset" }, { value: "cron", label: "Custom cron" }]}
            />
          </div>
          {v.scheduleType === "preset" ? (
            <Select value={v.schedulePreset} onChange={(e) => set("schedulePreset", e.target.value)} data-testid="job-preset">
              {PRESET_KEYS.map((p) => (
                <option key={p} value={p}>{p.replace(/_/g, " ")}</option>
              ))}
            </Select>
          ) : (
            <Input value={v.cronExpression} onChange={(e) => set("cronExpression", e.target.value)} className="font-mono text-xs" placeholder="0 8 * * 1-5" data-testid="job-cron" />
          )}
          <p className="text-xs font-medium text-fg" data-testid="schedule-summary">{summary}</p>
          {runs.length > 0 ? (
            <div className="space-y-0.5 border-t border-border/40 pt-2">
              <p className="text-[10px] uppercase tracking-wider text-fg-muted/60">Next 5 runs <span className="normal-case text-fg-muted/50">({tz})</span></p>
              {runs.map((d) => (
                <p key={d.toISOString()} className="font-mono text-[11px] tabular-nums text-fg-muted">{formatInZone(d, tz)}</p>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-danger">No upcoming runs — check the schedule.</p>
          )}
        </div>

        {/* Send condition */}
        <div className="flex gap-3">
          <div className="flex-1">
            <Label>Send condition</Label>
            <Select value={v.conditionMode} onChange={(e) => set("conditionMode", e.target.value as ConditionMode)} data-testid="job-condition">
              {CONDITIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </Select>
          </div>
          {v.conditionMode === "count_gt" && (
            <div className="w-28">
              <Label>Threshold</Label>
              <Input type="number" min={0} value={v.threshold} onChange={(e) => set("threshold", e.target.value)} data-testid="job-threshold" />
            </div>
          )}
        </div>

        {/* Advanced — template customization */}
        <div className="rounded-lg border border-border/50">
          <button
            type="button"
            onClick={() => setAdvanced((s) => !s)}
            data-testid="advanced-toggle"
            className="flex w-full items-center justify-between px-3.5 py-2.5 text-xs font-medium text-fg transition-colors hover:bg-surface-2/40"
          >
            <span>Advanced — template</span>
            <span className={`text-fg-muted transition-transform ${advanced ? "rotate-90" : ""}`}>›</span>
          </button>
          {advanced && (
            <div className="space-y-3 border-t border-border/50 p-3.5" data-testid="advanced-panel">
              <div>
                <Label>Template</Label>
                <Select value={v.templateId ?? ""} onChange={(e) => set("templateId", e.target.value || null)}>
                  <option value="">Default for this report</option>
                  {reportTemplates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}{t.isDefault ? " (default)" : ""}</option>
                  ))}
                </Select>
              </div>
              {selectedTemplate && (
                <iframe title="template preview" srcDoc={preview} className="h-64 w-full rounded-lg border border-border/50 bg-white" data-testid="template-preview" />
              )}
              <a
                href={`/templates?report=${v.reportType}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
              >
                Open full template editor →
              </a>
            </div>
          )}
        </div>

        {/* Edit-only: enable/disable */}
        {mode === "edit" && (
          <div className="flex items-center justify-between rounded-lg border border-border/50 px-3.5 py-2.5">
            <Label className="mb-0">Status</Label>
            <Segmented<"active" | "disabled">
              value={v.status}
              onChange={(s) => set("status", s)}
              options={[{ value: "active", label: "Active" }, { value: "disabled", label: "Disabled" }]}
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <Button variant="primary" onClick={submit} disabled={busy} data-testid="submit-job">
            {busy ? "Saving…" : mode === "edit" ? "Save changes" : "Create job"}
          </Button>
          <Button variant="ghost" onClick={() => router.push("/dashboard")} disabled={busy}>Cancel</Button>
          {err && <span className="text-xs text-danger" data-testid="job-error">{err}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
