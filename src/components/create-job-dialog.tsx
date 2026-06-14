"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconClose, IconPlus } from "@/components/icons";
import { Button, Input, Select, Label } from "@/components/ui/primitives";

const PRESETS = ["hourly", "daily", "weekly", "monthly", "business_days", "weekends"];
const CONDITIONS = ["always", "count_gt", "count_changed", "anomaly", "new_items"] as const;

export function CreateJobDialog({
  reportType,
  reportName,
  templateId,
  variant = "primary",
}: {
  reportType: string;
  reportName: string;
  templateId?: string;
  variant?: "primary" | "secondary" | "outline";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(reportName);
  const [preset, setPreset] = useState("daily");
  const [recipients, setRecipients] = useState("");
  const [mode, setMode] = useState<(typeof CONDITIONS)[number]>("always");
  const [threshold, setThreshold] = useState("5");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim() || reportName,
        reportType,
        templateId: templateId ?? null,
        scheduleType: "preset",
        schedulePreset: preset,
        recipients: recipients.split(",").map((s) => s.trim()).filter(Boolean),
        conditionalRules: mode === "count_gt" ? { mode, threshold: Number(threshold) } : { mode },
      }),
    });
    const body = await res.json();
    if (body.success) {
      setOpen(false);
      router.push("/dashboard");
      router.refresh();
    } else {
      setErr(body.error?.message ?? "Failed to create job");
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant={variant} size="sm" onClick={() => setOpen(true)} data-testid="open-create-job">
        <IconPlus className="h-3.5 w-3.5" /> Create job
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Create job"
            data-testid="create-job-dialog"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-xl border border-border/60 bg-surface shadow-elevated-lg animate-scale-in"
          >
            <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-fg">Create job</h2>
                <p className="mt-0.5 text-xs text-fg-muted/70">{reportName}</p>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg transition-colors">
                <IconClose className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <Label>Job name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label>Schedule</Label>
                <Select value={preset} onChange={(e) => setPreset(e.target.value)}>
                  {PRESETS.map((p) => <option key={p} value={p}>{p.replace("_", " ")}</option>)}
                </Select>
              </div>
              <div>
                <Label>Recipients (comma-separated)</Label>
                <Input value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="admin@contoso.com" />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label>Send when</Label>
                  <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                    {CONDITIONS.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
                  </Select>
                </div>
                {mode === "count_gt" && (
                  <div className="w-24">
                    <Label>Threshold</Label>
                    <Input type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
                  </div>
                )}
              </div>
              {err && <p className="text-xs text-danger">{err}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border/50 px-5 py-3">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={submit} disabled={busy} data-testid="submit-create-job">
                {busy ? "Creating…" : "Create job"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
