"use client";

import { useState } from "react";
import { JobForm, type JobFormValues } from "@/components/job-form";

interface QuickPreset {
  id: string;
  label: string;
  hint: string;
  values: Partial<JobFormValues>;
}

const PRESETS: QuickPreset[] = [
  {
    id: "daily-email",
    label: "Daily email",
    hint: "Every weekday at 8 AM",
    values: { scheduleType: "preset", schedulePreset: "business_days", conditionMode: "always" },
  },
  {
    id: "weekly-digest",
    label: "Weekly digest",
    hint: "Every Monday morning",
    values: { scheduleType: "preset", schedulePreset: "weekly", conditionMode: "always" },
  },
  {
    id: "on-change",
    label: "On-change alert",
    hint: "Only when the count changes",
    values: { scheduleType: "preset", schedulePreset: "daily", conditionMode: "count_changed" },
  },
];

export function CreateJobClient({
  catalog,
  reportType,
  reportName,
  cloneId,
}: {
  catalog: { id: string; name: string }[];
  reportType?: string;
  reportName?: string;
  cloneId?: string;
}) {
  const [initial, setInitial] = useState<Partial<JobFormValues>>({});
  const [formKey, setFormKey] = useState(0);
  const [active, setActive] = useState<string | null>(null);

  function apply(preset: QuickPreset) {
    setInitial(preset.values);
    setActive(preset.id);
    setFormKey((k) => k + 1); // remount JobForm so it picks up the preset defaults
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {!cloneId && (
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-wider text-fg-muted/60">Quick setup</p>
          <div className="grid grid-cols-3 gap-3" data-testid="quick-presets">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => apply(p)}
                data-testid={`preset-${p.id}`}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  active === p.id ? "border-accent bg-accent/5" : "border-border/60 hover:border-fg/40"
                }`}
              >
                <p className="text-xs font-semibold text-fg">{p.label}</p>
                <p className="mt-1 text-[11px] text-fg-muted leading-snug">{p.hint}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      <JobForm
        key={formKey}
        mode="create"
        reportType={reportType}
        reportName={reportName}
        catalog={catalog}
        sourceJobId={cloneId}
        cloneName={Boolean(cloneId)}
        initial={initial}
      />
    </div>
  );
}
