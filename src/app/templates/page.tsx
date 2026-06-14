"use client";

import { Suspense, useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { IconSave } from "@/components/icons";
import { AppShell } from "@/components/app-shell";
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
} from "@/components/ui/primitives";

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

type Mode = "html" | "text";

const VARS = [
  "organization_name", "reportName", "count", "executiveSummary",
  "trendArrow", "trendPercent", "trendDirection", "baselineAvg", "timestamp", "executionId",
  "anomalyBanner", "detailsTable",
];

function TemplatesEditor() {
  const reportParam = useSearchParams().get("report");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Template | null>(null);
  const [mode, setMode] = useState<Mode>("html");
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const pick = useCallback((t: Template) => {
    setSelected(t);
    setSubject(t.subject);
    setHtml(t.htmlBody);
    setText(t.textBody ?? "");
    setMsg(null);
  }, []);

  const load = useCallback(
    async (preselectReport?: string | null) => {
      const res = await fetch("/api/templates");
      const body = await res.json();
      if (!body.success) return;
      const list: Template[] = body.data;
      setTemplates(list);
      setLoaded(true);
      const match = preselectReport
        ? list.find((t) => t.reportType === preselectReport && t.isDefault) ??
          list.find((t) => t.reportType === preselectReport)
        : undefined;
      const next = match ?? list[0];
      if (next) pick(next);
    },
    [pick],
  );

  useEffect(() => {
    void load(reportParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportParam]);

  const renderPreview = useCallback(async () => {
    const reportType = selected?.reportType;
    const res = await fetch("/api/templates/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        mode === "html"
          ? { mode, htmlBody: html, subject, reportType }
          : { mode, textBody: text, subject, reportType },
      ),
    });
    const data = await res.json();
    if (data.success) setPreview(mode === "html" ? data.data.html : data.data.text);
  }, [mode, html, text, subject, selected?.reportType]);

  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void renderPreview(), 300);
    return () => clearTimeout(debounce.current);
  }, [renderPreview]);

  async function save() {
    if (!selected) return;
    setSaving(true);
    setMsg(null);
    const res = await fetch(`/api/templates/${selected.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject, htmlBody: html, textBody: text }),
    });
    const data = await res.json();
    setMsg(data.success ? "Saved." : `Error: ${data.error?.message}`);
    setSaving(false);
  }

  if (loaded && templates.length === 0) {
    return <EmptyState title="No templates" hint="Default templates are seeded per report on first run." />;
  }
  if (!loaded) {
    return (
      <div className="grid gap-4 lg:grid-cols-[220px_1fr_1fr]">
        <Skeleton className="h-64" /><Skeleton className="h-96" /><Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[240px_1fr_1fr]">
      {/* Template list sidebar */}
      <Card className="h-fit">
        <CardContent className="space-y-0.5 p-2">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => pick(t)}
              data-testid={`template-item-${t.reportType}`}
              className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition-all duration-200 ${
                selected?.id === t.id
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-surface-2 text-fg-muted hover:text-fg"
              }`}
            >
              <div className="truncate font-medium">{t.name}</div>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="font-mono text-[10px] text-fg-muted/70">{t.reportType}</span>
                {t.isDefault && <Badge className="text-success/80">default</Badge>}
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      {/* Editor panel */}
      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>Editor</CardTitle>
            {selected && <p className="mt-0.5 truncate text-xs text-fg-muted/70">{selected.name}</p>}
          </div>
          <Segmented<Mode>
            value={mode}
            onChange={setMode}
            options={[{ value: "html", label: "HTML" }, { value: "text", label: "Text" }]}
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="font-mono text-xs" />
          </div>
          <div>
            <Label>{mode === "html" ? "HTML body" : "Plain-text body"}</Label>
            {mode === "html" ? (
              <Textarea value={html} onChange={(e) => setHtml(e.target.value)} className="min-h-[360px]" data-testid="editor-html" />
            ) : (
              <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-[360px]" data-testid="editor-text" placeholder="Plain-text alternative…" />
            )}
          </div>
          <div>
            <Label>Insert variable</Label>
            <div className="flex flex-wrap gap-1.5">
              {VARS.map((v) => (
                <button
                  key={v}
                  onClick={() => (mode === "html" ? setHtml((b) => `${b}{{${v}}}`) : setText((b) => `${b}{{${v}}}`))}
                  className="rounded-lg border border-border/50 bg-surface-2/50 px-2 py-1 font-mono text-[10px] text-fg-muted transition-colors hover:text-fg hover:border-border/80"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={saving}>
              <IconSave className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save template"}
            </Button>
            {msg && <span className={`text-xs ${msg.startsWith("Error") ? "text-danger" : "text-fg-muted"}`}>{msg}</span>}
          </div>
        </CardContent>
      </Card>

      {/* Preview panel */}
      <Card>
        <CardHeader>
          <CardTitle>Live preview</CardTitle>
          <span className="text-[10px] uppercase tracking-wider text-fg-muted/60">{mode} · sample data</span>
        </CardHeader>
        <CardContent className="p-0">
          {mode === "html" ? (
            <iframe title="preview" srcDoc={preview} className="h-[520px] w-full rounded-b-xl border-0 bg-white" data-testid="preview-html" />
          ) : (
            <pre className="h-[520px] overflow-auto whitespace-pre-wrap rounded-b-xl bg-surface-2/50 p-4 font-mono text-xs leading-relaxed text-fg-muted" data-testid="preview-text">
              {preview}
            </pre>
          )}
        </CardContent>
      </Card>
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
