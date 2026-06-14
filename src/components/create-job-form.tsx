"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Select, Label } from "@/components/ui/primitives";

interface CatalogItem {
  id: string;
  name: string;
}

const PRESETS = ["hourly", "daily", "weekly", "monthly", "business_days", "weekends"];
const CONDITIONS = ["always", "count_gt", "count_changed", "anomaly", "new_items"] as const;

export function CreateJobForm({ catalog }: { catalog: CatalogItem[] }) {
  const router = useRouter();
  const [reportType, setReportType] = useState(catalog[0]?.id ?? "");
  const [name, setName] = useState("");
  const [preset, setPreset] = useState("daily");
  const [recipients, setRecipients] = useState("");
  const [mode, setMode] = useState<(typeof CONDITIONS)[number]>("always");
  const [threshold, setThreshold] = useState("0");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setMsg(null);
    const body = {
      name: name || catalog.find((c) => c.id === reportType)?.name || reportType,
      reportType,
      scheduleType: "preset" as const,
      schedulePreset: preset,
      recipients: recipients.split(",").map((s) => s.trim()).filter(Boolean),
      conditionalRules: mode === "count_gt" ? { mode, threshold: Number(threshold) } : { mode },
    };
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.success) {
      router.push("/dashboard");
      router.refresh();
    } else {
      setMsg(json.error?.message ?? "failed");
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create job</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Report type</Label>
          <Select value={reportType} onChange={(e) => setReportType(e.target.value)}>
            {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        <div>
          <Label>Name (optional)</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="defaults to report name" />
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
            <Label>Send condition</Label>
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
        <div className="flex items-center gap-3 pt-1">
          <Button onClick={submit} disabled={busy} className="w-full">
            {busy ? "Creating…" : "Create job"}
          </Button>
          {msg && <span className="text-xs text-danger">{msg}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
