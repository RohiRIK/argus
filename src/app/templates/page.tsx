"use client";

import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { IconSave, IconSend } from "@/components/icons";
import { AppShell } from "@/components/app-shell";
import {
  TemplateCodeEditor,
  type EditorVariableOption,
  type TemplateCodeEditorHandle,
} from "@/components/template-code-editor";
import { TemplateVisualComposer } from "@/components/template-visual-composer";
import { TemplateVariableInspector, type VariableItem } from "@/components/template-variable-inspector";
import { formatHtmlSource } from "@/services/report-engine/template-builder";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Textarea,
  Label,
  Badge,
  Segmented,
  EmptyState,
  Skeleton,
  Select,
} from "@/components/ui/primitives";
import { extractVariables } from "@/services/report-engine/template";
import { SHARED_TEMPLATE_TYPE } from "@/services/report-engine/default-template";

interface Template {
  id: string;
  name: string;
  reportType: string;
  subject: string;
  htmlBody: string;
  textBody: string | null;
  isDefault: boolean;
  language: "en" | "he";
}

interface TemplateVersion {
  id: string;
  version: number;
  subject: string;
  htmlBody: string;
  textBody: string | null;
  createdAt: string;
}

type Mode = "visual" | "html" | "text";
type PreviewDevice = "desktop" | "mobile";
type PreviewDataSource = "fixture" | "live";

interface ReportOption {
  id: string;
  name: string;
}

// Mirrors buildVars() / buildRawFragments() in services/report-engine/default-template.ts.
const CONTEXT_VARS = [
  "reportName",
  "organization_name",
  "categoryLabel",
  "executiveSummary",
  "count",
  "timestamp",
  "executionId",
] as const;
const TREND_VARS = [
  "trendArrow",
  "trendDisplay",
  "trendCaption",
  "trendPercent",
  "trendDirection",
  "baselineAvg",
  "addedCount",
  "removedCount",
] as const;
const CORE_VARS = [...CONTEXT_VARS, ...TREND_VARS] as const;
/** Pre-rendered HTML fragments — injected only into the HTML body (blank in subject / plain text). */
const HTML_BLOCK_VARS = ["anomalyBanner", "diffBanner", "detailsTable"] as const;
/** Plain-text blocks — substituted everywhere, intended for the text body. */
const TEXT_BLOCK_VARS = ["anomalyText", "diffText", "detailsText"] as const;
/** Substituted in every field (subject, HTML, text); tenantName is a legacy alias of organization_name. */
const PLAIN_VARS: readonly string[] = [...CORE_VARS, ...TEXT_BLOCK_VARS, "tenantName"];

const isSharedDefault = (t: Pick<Template, "reportType" | "isDefault">) =>
  t.isDefault && t.reportType === SHARED_TEMPLATE_TYPE;
const scopeLabel = (reportType: string) => (reportType === SHARED_TEMPLATE_TYPE ? "all reports" : reportType);

const VAR_DESCRIPTIONS: Record<string, string> = {
  categoryLabel: "Friendly report category (Identity, Security, Infrastructure)",
  reportName: "Report plugin display title",
  organization_name: "Configured or Entra-detected tenant display name",
  count: "Primary metric total from this execution",
  executiveSummary: "One-line operational summary of count and trigger rule",
  trendArrow: "Trend direction indicator (▲ / ▼ / ■)",
  trendPercent: "Unsigned % change relative to prior run",
  trendDisplay: "Trend % or First run when baseline is initializing",
  trendCaption: "Trend subtitle (vs. previous run or baseline initialized)",
  trendDirection: "Raw trend direction string (up, down, or flat)",
  baselineAvg: "Rolling baseline mean across recent executions",
  addedCount: "New item rows compared with previous snapshot",
  removedCount: "Resolved item rows compared with previous snapshot",
  timestamp: "Execution timestamp formatted in configured timezone",
  executionId: "Unique audit ID for this report run",
  anomalyBanner: "Red alert box rendered when anomaly detection triggers",
  diffBanner: "Blue callout showing added and resolved item counts",
  detailsTable: "Responsive HTML table of structured report rows",
  anomalyText: "Plain-text anomaly warning prefix",
  diffText: "Plain-text snapshot delta prefix",
  detailsText: "Formatted numbered list of result rows",
};

function describePluginVar(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
  return `Report metric: ${words.charAt(0).toUpperCase() + words.slice(1)}`;
}

function hasUnclosedBraces(s: string): boolean {
  const opens = (s.match(/\{\{/g) ?? []).length;
  const closes = (s.match(/\}\}/g) ?? []).length;
  return opens !== closes;
}

interface LoadResult {
  list: Template[];
  reports: ReportOption[];
  error?: string;
}

async function fetchTemplatesAndReports(): Promise<LoadResult> {
  try {
    const [res, catalogRes] = await Promise.all([fetch("/api/templates"), fetch("/api/catalog")]);
    const body = await res.json();
    const catalog = await catalogRes.json().catch(() => null);
    if (!res.ok || !body.success) {
      return { list: [], reports: [], error: body.error?.message ?? `Failed to load templates (${res.status})` };
    }
    const reports = catalog?.success ? (catalog.data as ReportOption[]).map(({ id, name }) => ({ id, name })) : [];
    return { list: body.data as Template[], reports };
  } catch (err) {
    return { list: [], reports: [], error: err instanceof Error ? err.message : "Failed to load templates" };
  }
}

const DESKTOP_CANVAS_PX = 712;
const DESKTOP_PREVIEW_HEIGHT = 540;

function TemplatesEditor() {
  const reportParam = useSearchParams().get("report");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Template | null>(null);
  const [mode, setMode] = useState<Mode>("html");

  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [text, setText] = useState("");

  const [previewHtml, setPreviewHtml] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [previewSubject, setPreviewSubject] = useState("");
  const [pluginVars, setPluginVars] = useState<string[]>([]);
  const [sampleValues, setSampleValues] = useState<Record<string, string>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>("desktop");
  const [previewDataSource, setPreviewDataSource] = useState<PreviewDataSource>("fixture");
  const [previewContainerWidth, setPreviewContainerWidth] = useState(DESKTOP_CANVAS_PX);

  const [testSendOpen, setTestSendOpen] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [testSendMsg, setTestSendMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [saving, setSaving] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [inspectVersionId, setInspectVersionId] = useState<string | null>(null);
  const [confirmRevertId, setConfirmRevertId] = useState<string | null>(null);
  const [reverting, setReverting] = useState<string | null>(null);
  const [reports, setReports] = useState<ReportOption[]>([]);
  const [previewReportPick, setPreviewReportPick] = useState<string | null>(null);

  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previewSeq = useRef(0);
  const previewAbort = useRef<AbortController | null>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const versionsSeq = useRef(0);
  const focusedField = useRef<"subject" | "body">("body");
  const subjectRef = useRef<HTMLInputElement>(null);
  const codeEditorRef = useRef<TemplateCodeEditorHandle>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const isDirty = useMemo(() => {
    if (!selected) return false;
    return (
      name !== selected.name ||
      subject !== selected.subject ||
      html !== selected.htmlBody ||
      (text.trim() === "" ? "" : text) !== (selected.textBody ?? "")
    );
  }, [selected, name, subject, html, text]);

  const isShared = selected?.reportType === SHARED_TEMPLATE_TYPE;
  // Shared templates have no report of their own: preview against the picked / deep-linked / first report.
  const previewReport = isShared ? previewReportPick ?? reportParam ?? reports[0]?.id : selected?.reportType;
  const previewReportName = reports.find((r) => r.id === previewReport)?.name ?? previewReport;

  const usedVarsSet = useMemo(() => {
    const activeBody = mode === "text" ? text : html;
    return new Set([...extractVariables(subject), ...extractVariables(activeBody)]);
  }, [mode, subject, html, text]);

  // Subject and text body are rendered without the HTML fragments; the HTML body gets them too.
  const unknownVars = useMemo(() => {
    const plain = new Set<string>([...PLAIN_VARS, ...pluginVars]);
    const body = mode === "text" ? plain : new Set<string>([...plain, ...HTML_BLOCK_VARS]);
    const unknown = new Set([
      ...extractVariables(subject).filter((v) => !plain.has(v)),
      ...extractVariables(mode === "text" ? text : html).filter((v) => !body.has(v)),
    ]);
    return [...unknown];
  }, [mode, subject, html, text, pluginVars]);

  const syntaxWarning = useMemo(() => {
    const activeBody = mode === "text" ? text : html;
    if (hasUnclosedBraces(subject) || hasUnclosedBraces(activeBody)) {
      return "Unclosed {{variable}} braces detected.";
    }
    return null;
  }, [mode, subject, html, text]);

  const editorVariableOptions = useMemo<EditorVariableOption[]>(() => {
    const out: EditorVariableOption[] = [];
    for (const v of pluginVars) {
      out.push({ name: v, group: "report", sample: sampleValues[v], description: describePluginVar(v) });
    }
    for (const v of HTML_BLOCK_VARS) {
      out.push({ name: v, group: "fragment", sample: "HTML block", description: VAR_DESCRIPTIONS[v] });
    }
    for (const v of CORE_VARS) {
      out.push({ name: v, group: "core", sample: sampleValues[v], description: VAR_DESCRIPTIONS[v] });
    }
    return out;
  }, [pluginVars, sampleValues]);

  const inspectorItems = useMemo<VariableItem[]>(() => {
    const item = (name: string, group: VariableItem["group"], description: string, sample?: string): VariableItem => ({
      name,
      group,
      description,
      sample,
      used: usedVarsSet.has(name),
    });
    const blockVars = mode === "text" ? TEXT_BLOCK_VARS : HTML_BLOCK_VARS;
    const blockSample = mode === "text" ? "Plain-text block" : "Rendered HTML";
    return [
      ...CONTEXT_VARS.map((v) => item(v, "context", VAR_DESCRIPTIONS[v], sampleValues[v])),
      ...TREND_VARS.map((v) => item(v, "trend", VAR_DESCRIPTIONS[v], sampleValues[v])),
      ...blockVars.map((v) => item(v, "block", VAR_DESCRIPTIONS[v], blockSample)),
      // Core names win over same-named plugin variables in buildVars(), so skip duplicates.
      ...pluginVars
        .filter((v) => !PLAIN_VARS.includes(v))
        .map((v) => item(v, "report", describePluginVar(v), sampleValues[v])),
    ];
  }, [pluginVars, sampleValues, usedVarsSet, mode]);

  const insertTargetLabel = mode === "visual" ? "Copy to clipboard" : mode === "html" ? "HTML cursor" : "Text cursor";

  // Auto-scale desktop preview container cleanly via ResizeObserver.
  useEffect(() => {
    const el = previewWrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const updateWidth = () => {
      const next = el.clientWidth;
      if (next > 0) setPreviewContainerWidth(next);
    };
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loaded, previewDevice, mode]);

  const desktopScale = useMemo(() => {
    if (previewContainerWidth <= 0) return 1;
    return Math.min(1, Math.max(0.45, (previewContainerWidth - 8) / DESKTOP_CANVAS_PX));
  }, [previewContainerWidth]);

  const loadVersions = useCallback(async (templateId: string) => {
    const seq = ++versionsSeq.current;
    try {
      const res = await fetch(`/api/templates/${templateId}/versions`);
      const body = await res.json();
      if (seq !== versionsSeq.current) return;
      setVersions(body.success ? body.data : []);
    } catch {
      if (seq === versionsSeq.current) setVersions([]);
    }
  }, []);

  const applySelected = useCallback(
    (t: Template) => {
      setSelected(t);
      setName(t.name);
      setSubject(t.subject);
      setHtml(t.htmlBody);
      setText(t.textBody ?? "");
      setMsg(null);
      setFieldErrors({});
      setConfirmReset(false);
      setInspectVersionId(null);
      setConfirmRevertId(null);
      void loadVersions(t.id);
    },
    [loadVersions],
  );

  const applyLoaded = useCallback(
    (r: LoadResult) => {
      setLoaded(true);
      setLoadError(r.error ?? null);
      setReports(r.reports);
      setTemplates(r.list);
      const next = r.list.find(isSharedDefault) ?? r.list[0];
      if (next) applySelected(next);
    },
    [applySelected],
  );

  // State is only set in the promise callback, never synchronously in the effect body.
  useEffect(() => {
    let active = true;
    void fetchTemplatesAndReports().then((r) => {
      if (active) applyLoaded(r);
    });
    return () => {
      active = false;
    };
  }, [applyLoaded]);

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  const renderPreview = useCallback(async () => {
    if (!selected) return;
    previewAbort.current?.abort();
    const ctrl = new AbortController();
    previewAbort.current = ctrl;
    const seq = ++previewSeq.current;
    const apiMode = mode === "text" ? "text" : "html";
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch("/api/templates/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify(
          apiMode === "html"
            ? { mode: "html", dataSource: previewDataSource, htmlBody: html, subject, reportType: previewReport }
            : { mode: "text", dataSource: previewDataSource, textBody: text, subject, reportType: previewReport },
        ),
      });
      const data = await res.json();
      if (seq !== previewSeq.current) return;
      if (!res.ok || !data.success) {
        setPreviewError(data.error?.message ?? `Preview failed (${res.status})`);
      } else {
        if (apiMode === "html") setPreviewHtml(data.data.html ?? "");
        else setPreviewText(data.data.text ?? "");
        setPreviewSubject(data.data.subject ?? "");
        if (Array.isArray(data.data.availableVars)) {
          setPluginVars(data.data.availableVars as string[]);
        }
        if (data.data.sampleValues && typeof data.data.sampleValues === "object") {
          setSampleValues(data.data.sampleValues as Record<string, string>);
        }
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      if (seq === previewSeq.current) {
        setPreviewError(err instanceof Error ? err.message : "Preview request failed");
      }
    } finally {
      if (seq === previewSeq.current) setPreviewLoading(false);
    }
  }, [mode, previewDataSource, html, text, subject, selected, previewReport]);

  useEffect(() => {
    if (!selected) return;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void renderPreview(), previewDataSource === "live" ? 350 : 200);
    return () => clearTimeout(debounce.current);
  }, [renderPreview, selected, previewDataSource]);

  const validateFields = useCallback((): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Template name is required";
    if (!subject.trim()) errs.subject = "Subject cannot be blank";
    else if (/[\r\n]/.test(subject)) errs.subject = "Subject must be a single line";
    if (!html.trim()) errs.htmlBody = "HTML body cannot be blank";
    return errs;
  }, [name, subject, html]);

  const save = useCallback(async () => {
    if (!selected || saving) return;
    const errs = validateFields();
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setMsg("Error: Fix validation errors before saving.");
      return;
    }
    setSaving(true);
    setMsg(null);
    setFieldErrors({});
    try {
      const normalizedText = text.trim() === "" ? null : text;
      const res = await fetch(`/api/templates/${selected.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          subject: subject.trim(),
          htmlBody: html,
          textBody: normalizedText,
          language: selected.language,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const updated: Template = data.data;
        setSelected(updated);
        setName(updated.name);
        setSubject(updated.subject);
        setHtml(updated.htmlBody);
        setText(updated.textBody ?? "");
        setTemplates((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
        setMsg("Saved.");
        void loadVersions(updated.id);
      } else {
        if (data.error?.fields) setFieldErrors(data.error.fields);
        setMsg(`Error: ${data.error?.message ?? "Save failed"}`);
      }
    } catch (err) {
      setMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [selected, saving, validateFields, name, subject, html, text, loadVersions]);

  // Cmd/Ctrl+S keyboard shortcut to save.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (isDirty && !saving) void save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDirty, saving, save]);

  async function cloneSelected() {
    if (!selected || cloning) return;
    const baseName = (name.trim() || selected.name).slice(0, 110);
    setCloning(true);
    setMsg(null);
    try {
      const normalizedText = text.trim() === "" ? null : text;
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: `${baseName} (copy)`,
          reportType: selected.reportType,
          subject: subject.trim() || selected.subject,
          htmlBody: html.trim() ? html : selected.htmlBody,
          textBody: normalizedText,
          isDefault: false,
          language: selected.language,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const created: Template = data.data;
        setTemplates((prev) => [...prev, created]);
        applySelected(created);
        setMsg("Cloned template.");
      } else {
        setMsg(`Error: ${data.error?.message ?? "Clone failed"}`);
      }
    } catch (err) {
      setMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCloning(false);
    }
  }

  async function deleteSelected() {
    if (!selected || selected.isDefault || deleting) return;
    setDeleting(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/templates/${selected.id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        const remaining = templates.filter((t) => t.id !== selected.id);
        setTemplates(remaining);
        if (remaining[0]) applySelected(remaining[0]);
        else setSelected(null);
      } else {
        setMsg(`Error: ${data.error?.message ?? "Delete failed"}`);
      }
    } catch (err) {
      setMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeleting(false);
    }
  }

  async function resetToDefault() {
    if (!selected || resetting) return;
    setResetting(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/templates/${selected.id}/reset`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        const updated: Template = data.data;
        setTemplates((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
        applySelected(updated);
        setMsg("Reset to built-in default.");
      } else {
        setMsg(`Error: ${data.error?.message ?? "Reset failed"}`);
      }
    } catch (err) {
      setMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setResetting(false);
      setConfirmReset(false);
    }
  }

  async function revert(versionId: string) {
    if (!selected) return;
    setReverting(versionId);
    setMsg(null);
    try {
      const res = await fetch(`/api/templates/${selected.id}/versions/${versionId}/revert`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        const t: Template = data.data;
        setTemplates((prev) => prev.map((x) => (x.id === t.id ? t : x)));
        applySelected(t);
        setMsg(`Reverted to v${versions.find((v) => v.id === versionId)?.version ?? "?"}.`);
      } else {
        setMsg(`Error: ${data.error?.message ?? "Revert failed"}`);
      }
    } catch (err) {
      setMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReverting(null);
      setConfirmRevertId(null);
    }
  }

  async function sendTestDraft() {
    if (!selected || sendingTest) return;
    setSendingTest(true);
    setTestSendMsg(null);
    try {
      const res = await fetch("/api/templates/test-send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(testTo.trim() ? { to: testTo.trim() } : {}),
          reportType: previewReport,
          subject: subject.trim() || selected.subject,
          htmlBody: html.trim() ? html : selected.htmlBody,
          dataSource: previewDataSource,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTestSendMsg({ ok: true, text: `Sent test email to ${data.data.to}.` });
      } else {
        setTestSendMsg({ ok: false, text: data.error?.message ?? "Could not send test email." });
      }
    } catch (err) {
      setTestSendMsg({ ok: false, text: err instanceof Error ? err.message : "Test send failed" });
    } finally {
      setSendingTest(false);
    }
  }

  function insertVar(variable: string) {
    const token = `{{${variable}}}`;
    if (focusedField.current === "subject") {
      const target = subjectRef.current;
      if (target && typeof target.selectionStart === "number" && typeof target.selectionEnd === "number") {
        const start = target.selectionStart;
        const end = target.selectionEnd;
        setSubject(`${subject.slice(0, start)}${token}${subject.slice(end)}`);
        requestAnimationFrame(() => {
          target.focus();
          target.setSelectionRange(start + token.length, start + token.length);
        });
        return;
      }
      setSubject(`${subject}${token}`);
      return;
    }

    if (mode === "html" && codeEditorRef.current) {
      codeEditorRef.current.insertText(token);
      return;
    }

    if (mode === "visual") {
      void navigator.clipboard?.writeText(token).catch(() => {});
      setMsg(`Copied ${token} — paste into Subject, Custom intro, or Footer.`);
      return;
    }

    const target = textRef.current;
    if (target && typeof target.selectionStart === "number" && typeof target.selectionEnd === "number") {
      const start = target.selectionStart;
      const end = target.selectionEnd;
      setText(`${text.slice(0, start)}${token}${text.slice(end)}`);
      requestAnimationFrame(() => {
        target.focus();
        target.setSelectionRange(start + token.length, start + token.length);
      });
      return;
    }
    setText(`${text}${token}`);
  }



  const inspectedVersion = versions.find((v) => v.id === inspectVersionId) ?? null;

  if (loaded && loadError) {
    return (
      <EmptyState
        title="Could not load templates"
        hint={loadError}
        action={<Button variant="outline" size="sm" onClick={() => void fetchTemplatesAndReports().then(applyLoaded)}>Retry</Button>}
      />
    );
  }
  if (loaded && templates.length === 0) {
    return <EmptyState title="No templates" hint="The shared report template is created on first run." />;
  }
  if (!loaded) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-96" /><Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Studio top bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-surface px-3 py-2 text-xs">
        <div className="flex items-center gap-2.5">
          {selected && (
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-semibold text-fg">{selected.name}</span>
              <span className="hidden font-mono text-[11px] text-fg-muted sm:inline">{scopeLabel(selected.reportType)}</span>
              {isSharedDefault(selected) && <Badge className="text-success/90">shared default</Badge>}
              {isDirty && <Badge className="border-warning/40 bg-warning/10 text-warning">Unsaved</Badge>}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selected && (confirmReset ? (
            <>
              <Button variant="danger" size="sm" onClick={() => void resetToDefault()} disabled={resetting} data-testid="confirm-reset-template">
                {resetting ? "Resetting…" : "Confirm reset"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>Cancel</Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)} disabled={resetting} data-testid="reset-template">
              Reset
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={() => void cloneSelected()} disabled={!selected || cloning} data-testid="clone-template">
            {cloning ? "Cloning…" : "Clone"}
          </Button>
          {selected && !selected.isDefault && (
            <Button variant="ghost" size="sm" onClick={() => void deleteSelected()} disabled={deleting} data-testid="delete-template">
              Delete
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* Dual-Mode Studio Editor panel */}
        <Card className="min-w-0">
          <CardHeader>
            <div className="min-w-0">
              <CardTitle>Studio</CardTitle>
              <p className="mt-0.5 text-[11px] text-fg-muted/75">
                {mode === "visual"
                  ? "Configure layout & branding visually"
                  : mode === "html"
                    ? "Syntax-highlighted HTML · Type {{ for variables"
                    : "Plain-text preview & export body"}
              </p>
            </div>
            <Segmented<Mode>
              value={mode}
              onChange={setMode}
              options={[
                { value: "visual", label: "Visual" },
                { value: "html", label: "HTML" },
                { value: "text", label: "Text" },
              ]}
            />
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Template name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setFieldErrors(validateFields())}
                  className="text-xs"
                  data-testid="template-name"
                />
                {fieldErrors.name && <p className="mt-1 text-[11px] text-danger">{fieldErrors.name}</p>}
              </div>

              <div>
                <Label>Subject line</Label>
                <Input
                  ref={subjectRef}
                  value={subject}
                  onFocus={() => { focusedField.current = "subject"; }}
                  onBlur={() => setFieldErrors(validateFields())}
                  onChange={(e) => setSubject(e.target.value)}
                  className="font-mono text-xs"
                  data-testid="template-subject"
                />
                {fieldErrors.subject && <p className="mt-1 text-[11px] text-danger">{fieldErrors.subject}</p>}
              </div>
            </div>

            {mode === "visual" ? (
              <TemplateVisualComposer html={html} onApplyHtml={setHtml} />
            ) : mode === "html" ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label className="mb-0">HTML source</Label>
                  <button
                    type="button"
                    onClick={() => setHtml((src) => formatHtmlSource(src))}
                    data-testid="format-html"
                    className="rounded border border-border/60 bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-fg-muted transition-colors hover:border-border hover:text-fg"
                  >
                    Format HTML
                  </button>
                </div>
                <TemplateCodeEditor
                  ref={codeEditorRef}
                  value={html}
                  onChange={setHtml}
                  variables={editorVariableOptions}
                  testId="editor-html"
                  onFocus={() => { focusedField.current = "body"; }}
                  onBlur={() => setFieldErrors(validateFields())}
                />
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <Label>Plain-text body</Label>
                  <span className="text-[10px] text-fg-muted/70">Used for text preview &amp; export (live emails use HTML)</span>
                </div>
                <Textarea
                  ref={textRef}
                  value={text}
                  onFocus={() => { focusedField.current = "body"; }}
                  onChange={(e) => setText(e.target.value)}
                  className="min-h-[380px]"
                  data-testid="editor-text"
                  placeholder="Plain-text alternative…"
                />
              </div>
            )}

            {fieldErrors.htmlBody && <p className="text-[11px] text-danger">{fieldErrors.htmlBody}</p>}
            {syntaxWarning && <p className="text-[11px] text-warning">{syntaxWarning}</p>}
            {unknownVars.length > 0 && (
              <p className="text-[11px] text-warning/90">
                Unrecognized tokens (will render blank unless emitted by report): {unknownVars.map((v) => `{{${v}}}`).join(", ")}
              </p>
            )}

            {/* Tabbed, Searchable Variable Inspector */}
            <TemplateVariableInspector
              items={inspectorItems}
              reportLabel={previewReportName}
              shared={isShared}
              insertTargetLabel={insertTargetLabel}
              onInsert={insertVar}
            />

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void save()} disabled={saving} data-testid="save-template">
                <IconSave className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save template"}
              </Button>
              <span className="text-[11px] text-fg-muted/60">⌘S / Ctrl+S</span>
              {msg && (
                <span className={`text-xs ${msg.startsWith("Error") ? "text-danger" : "text-fg-muted"}`} data-testid="template-save-msg">
                  {msg}
                </span>
              )}
            </div>

            {/* Version history (progressive disclosure) */}
            <div className="border-t border-border/50 pt-3" data-testid="version-history">
              <button
                type="button"
                onClick={() => setShowHistory((s) => !s)}
                className="flex w-full items-center justify-between text-xs font-medium text-fg-muted hover:text-fg"
              >
                <span>Version history ({versions.length})</span>
                <span>{showHistory ? "−" : "+"}</span>
              </button>
              {showHistory && (
                <div className="mt-2.5 space-y-2">
                  {versions.length === 0 ? (
                    <p className="text-xs text-fg-muted/60">No previous versions yet — saving content changes creates a snapshot.</p>
                  ) : (
                    <ul className="max-h-56 divide-y divide-border/40 overflow-auto rounded-lg border border-border/50">
                      {versions.map((v) => (
                        <li key={v.id} className="space-y-2 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <span className="font-mono text-[11px] text-fg">v{v.version}</span>
                              <span className="ml-2 truncate text-[11px] text-fg-muted/80">{v.subject}</span>
                              <span className="ml-2 text-[10px] text-fg-muted/50">{new Date(v.createdAt).toLocaleString()}</span>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setInspectVersionId((id) => (id === v.id ? null : v.id))}
                              >
                                {inspectVersionId === v.id ? "Hide" : "Inspect"}
                              </Button>
                              {confirmRevertId === v.id ? (
                                <>
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    disabled={reverting !== null}
                                    data-testid={`revert-${v.version}`}
                                    onClick={() => void revert(v.id)}
                                  >
                                    {reverting === v.id ? "Reverting…" : "Confirm"}
                                  </Button>
                                  <Button variant="ghost" size="sm" onClick={() => setConfirmRevertId(null)}>Cancel</Button>
                                </>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={reverting !== null}
                                  data-testid={`revert-${v.version}`}
                                  onClick={() => setConfirmRevertId(v.id)}
                                >
                                  Revert
                                </Button>
                              )}
                            </div>
                          </div>
                          {inspectedVersion?.id === v.id && (
                            <pre className="max-h-36 overflow-auto rounded-md border border-border/40 bg-surface-2/60 p-2 font-mono text-[11px] text-fg-muted">
                              {mode === "text" ? v.textBody ?? "(empty plain-text body)" : v.htmlBody}
                            </pre>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Auto-scaled Desktop / Mobile & Live Tenant Preview panel */}
        <Card className="min-w-0">
          <CardHeader className="flex-wrap gap-2">
            <div>
              <CardTitle>Live preview</CardTitle>
              <span className="text-[10px] uppercase tracking-wider text-fg-muted/70">
                {previewLoading
                  ? "rendering…"
                  : `${mode === "text" ? "text" : previewDevice} · ${previewDataSource === "live" ? "live tenant" : "fixture data"}`}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {isShared && reports.length > 0 && (
                <Select
                  aria-label="Preview as report"
                  value={previewReport ?? ""}
                  onChange={(e) => setPreviewReportPick(e.target.value)}
                  className="h-7 max-w-[180px] py-0 text-[11px]"
                  data-testid="preview-report"
                >
                  {reports.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </Select>
              )}
              {mode !== "text" && (
                <div className="inline-flex rounded-md border border-border/60 bg-surface-2 p-0.5 text-[11px]">
                  <button
                    type="button"
                    data-testid="preview-device-desktop"
                    onClick={() => setPreviewDevice("desktop")}
                    className={`rounded px-2 py-0.5 font-medium transition-colors ${
                      previewDevice === "desktop" ? "bg-surface text-fg shadow-xs" : "text-fg-muted hover:text-fg"
                    }`}
                  >
                    Desktop
                  </button>
                  <button
                    type="button"
                    data-testid="preview-device-mobile"
                    onClick={() => setPreviewDevice("mobile")}
                    className={`rounded px-2 py-0.5 font-medium transition-colors ${
                      previewDevice === "mobile" ? "bg-surface text-fg shadow-xs" : "text-fg-muted hover:text-fg"
                    }`}
                  >
                    Mobile
                  </button>
                </div>
              )}

              <div className="inline-flex rounded-md border border-border/60 bg-surface-2 p-0.5 text-[11px]">
                <button
                  type="button"
                  data-testid="preview-source-fixture"
                  onClick={() => setPreviewDataSource("fixture")}
                  className={`rounded px-2 py-0.5 font-medium transition-colors ${
                    previewDataSource === "fixture" ? "bg-surface text-fg shadow-xs" : "text-fg-muted hover:text-fg"
                  }`}
                >
                  Fixture
                </button>
                <button
                  type="button"
                  data-testid="preview-source-live"
                  onClick={() => setPreviewDataSource("live")}
                  className={`rounded px-2 py-0.5 font-medium transition-colors ${
                    previewDataSource === "live" ? "bg-primary/15 text-primary shadow-xs" : "text-fg-muted hover:text-fg"
                  }`}
                >
                  Live
                </button>
              </div>

              {mode !== "text" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setTestSendOpen((v) => !v);
                    setTestSendMsg(null);
                  }}
                  data-testid="template-test-send-toggle"
                >
                  <IconSend className="h-3 w-3" /> Test
                </Button>
              )}
            </div>
          </CardHeader>

          {testSendOpen && mode !== "text" && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border/50 bg-surface-2/40 px-4 py-2.5 text-xs">
              <Input
                type="email"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="Recipient email (defaults to Admin Contact)"
                className="h-8 min-w-[200px] flex-1 text-xs"
                data-testid="template-test-to"
              />
              <Button type="button" size="sm" disabled={sendingTest} onClick={() => void sendTestDraft()} data-testid="template-test-send-btn">
                {sendingTest ? "Sending…" : "Send test email"}
              </Button>
              {testSendMsg && (
                <span className={`w-full text-[11px] ${testSendMsg.ok ? "text-success" : "text-danger"}`}>
                  {testSendMsg.ok ? "✓ " : "✕ "}
                  {testSendMsg.text}
                </span>
              )}
            </div>
          )}

          <div className="border-b border-border/50 bg-surface-2/40 px-4 py-2 text-xs">
            <span className="text-fg-muted">Subject: </span>
            <span className="font-mono text-fg" data-testid="preview-subject">{previewSubject || "—"}</span>
          </div>
          {previewError && (
            <div className="border-b border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger" data-testid="preview-error">
              {previewError}
            </div>
          )}
          <CardContent className="p-2">
            <div ref={previewWrapRef} className="w-full">
              {mode === "text" ? (
                <pre
                  className="h-[540px] overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2/50 p-4 font-mono text-xs leading-relaxed text-fg-muted"
                  data-testid="preview-text"
                >
                  {previewText}
                </pre>
              ) : previewDevice === "mobile" ? (
                <div className="flex justify-center overflow-auto rounded-lg bg-bg-subtle/60 p-3">
                  <div className="w-[375px] max-w-full overflow-hidden rounded-xl border border-border bg-white shadow-sm">
                    <iframe
                      title="preview"
                      sandbox=""
                      srcDoc={previewHtml}
                      className="h-[540px] w-full border-0 bg-white"
                      data-testid="preview-html"
                    />
                  </div>
                </div>
              ) : (
                <div
                  className="relative w-full overflow-hidden rounded-lg border border-border/50 bg-white"
                  style={{ height: `${DESKTOP_PREVIEW_HEIGHT}px` }}
                >
                  <iframe
                    title="preview"
                    sandbox=""
                    srcDoc={previewHtml}
                    data-testid="preview-html"
                    className="border-0 bg-white"
                    style={{
                      width: `${DESKTOP_CANVAS_PX}px`,
                      height: `${Math.round(DESKTOP_PREVIEW_HEIGHT / desktopScale)}px`,
                      transform: `scale(${desktopScale})`,
                      transformOrigin: "top left",
                    }}
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  return (
    <AppShell title="Templates">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <TemplatesEditor />
      </Suspense>
    </AppShell>
  );
}
