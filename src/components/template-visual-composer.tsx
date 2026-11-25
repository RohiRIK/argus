"use client";

import { useMemo } from "react";
import {
  VISUAL_PRESETS,
  compileVisualTemplate,
  parseVisualConfig,
  type VisualPresetId,
  type VisualSectionKey,
  type VisualTemplateConfig,
} from "@/services/report-engine/template-builder";
import { Button, Input, Label, Segmented } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

const ACCENT_SWATCHES = ["#2563eb", "#0f172a", "#dc2626", "#059669", "#7c3aed", "#d97706"] as const;

const SECTION_META: Record<
  VisualSectionKey,
  { label: string; toggleKey?: keyof Pick<VisualTemplateConfig, "showAnomalyBanner" | "showDiffBanner" | "showSummary" | "showKpiCards" | "showDetailsTable"> }
> = {
  anomaly: { label: "Anomaly alert banner", toggleKey: "showAnomalyBanner" },
  diff: { label: "Row-diff changes callout", toggleKey: "showDiffBanner" },
  intro: { label: "Custom intro callout" },
  summary: { label: "Executive summary", toggleKey: "showSummary" },
  kpis: { label: "KPI cards (Metric + Trend)", toggleKey: "showKpiCards" },
  table: { label: "Structured details table", toggleKey: "showDetailsTable" },
};

export function TemplateVisualComposer({
  html,
  onApplyHtml,
}: {
  html: string;
  onApplyHtml: (nextHtml: string) => void;
}) {
  const parsed = useMemo(() => parseVisualConfig(html), [html]);
  const config: VisualTemplateConfig = parsed ?? VISUAL_PRESETS.operator.config;
  const isCustomHtml = parsed === null;

  function update(patch: Partial<VisualTemplateConfig>) {
    const next: VisualTemplateConfig = { ...config, ...patch };
    onApplyHtml(compileVisualTemplate(next));
  }

  function applyPreset(presetId: VisualPresetId) {
    onApplyHtml(compileVisualTemplate(VISUAL_PRESETS[presetId].config));
  }

  function moveSection(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= config.sectionOrder.length) return;
    const order = [...config.sectionOrder];
    [order[index], order[target]] = [order[target], order[index]];
    update({ sectionOrder: order });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border/60 bg-surface-2/25 p-3.5" data-testid="editor-visual">
      {isCustomHtml && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/35 bg-warning/10 px-3 py-2 text-xs text-fg">
          <span>
            This template uses custom HTML. Tweaking any control below will generate fresh Outlook-safe layout HTML (your previous HTML stays in Version History).
          </span>
        </div>
      )}

      {/* One-click design presets */}
      <div>
        <Label>Design preset</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.entries(VISUAL_PRESETS) as Array<[VisualPresetId, (typeof VISUAL_PRESETS)[VisualPresetId]]>).map(
            ([id, p]) => {
              const active = !isCustomHtml && config.preset === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => applyPreset(id)}
                  data-testid={`visual-preset-${id}`}
                  className={cn(
                    "rounded-lg border p-2.5 text-left transition-colors",
                    active
                      ? "border-primary/60 bg-primary/10"
                      : "border-border/60 bg-surface hover:border-border",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-fg">{p.label}</span>
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: p.config.accentColor }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-fg-muted">{p.description}</p>
                </button>
              );
            },
          )}
        </div>
      </div>

      {/* Branding controls */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label>Accent color</Label>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {ACCENT_SWATCHES.map((hex) => (
              <button
                key={hex}
                type="button"
                aria-label={`Accent ${hex}`}
                onClick={() => update({ accentColor: hex })}
                className={cn(
                  "h-6 w-6 rounded-md border transition-transform hover:scale-105",
                  config.accentColor.toLowerCase() === hex ? "ring-2 ring-ring border-white" : "border-border/70",
                )}
                style={{ backgroundColor: hex }}
              />
            ))}
          </div>
        </div>

        <div>
          <Label>Header style</Label>
          <Segmented<VisualTemplateConfig["headerStyle"]>
            value={config.headerStyle}
            onChange={(headerStyle) => update({ headerStyle })}
            options={[
              { value: "clean", label: "Clean" },
              { value: "banner", label: "Banner" },
              { value: "left-accent", label: "Accent" },
            ]}
          />
        </div>

        <div>
          <Label>Spacing density</Label>
          <Segmented<VisualTemplateConfig["density"]>
            value={config.density}
            onChange={(density) => update({ density })}
            options={[
              { value: "comfortable", label: "Comfy" },
              { value: "compact", label: "Compact" },
            ]}
          />
        </div>
      </div>

      {/* Header metadata toggles */}
      <div className="flex flex-wrap items-center gap-4 border-t border-border/40 pt-3 text-xs">
        <label className="inline-flex cursor-pointer items-center gap-2 text-fg">
          <input
            type="checkbox"
            checked={config.showOrgName}
            onChange={(e) => update({ showOrgName: e.target.checked })}
            className="h-3.5 w-3.5 accent-primary"
          />
          <span>Show organization name</span>
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2 text-fg">
          <input
            type="checkbox"
            checked={config.showCategoryDate}
            onChange={(e) => update({ showCategoryDate: e.target.checked })}
            className="h-3.5 w-3.5 accent-primary"
          />
          <span>Show category &amp; timestamp</span>
        </label>
      </div>

      {/* Reorderable email sections */}
      <div>
        <Label>Email blocks &amp; order</Label>
        <div className="divide-y divide-border/40 rounded-lg border border-border/60 bg-surface">
          {config.sectionOrder.map((key, idx) => {
            const meta = SECTION_META[key];
            const enabled = meta.toggleKey ? config[meta.toggleKey] : config.customIntro.trim().length > 0;
            return (
              <div key={key} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                <label className="flex cursor-pointer items-center gap-2 text-fg">
                  {meta.toggleKey ? (
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => update({ [meta.toggleKey!]: e.target.checked })}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                  ) : (
                    <span className={cn("h-2 w-2 rounded-full", enabled ? "bg-primary" : "bg-border")} />
                  )}
                  <span className={enabled ? "font-medium" : "text-fg-muted"}>{meta.label}</span>
                </label>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={idx === 0}
                    onClick={() => moveSection(idx, -1)}
                    aria-label={`Move ${meta.label} up`}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={idx === config.sectionOrder.length - 1}
                    onClick={() => moveSection(idx, 1)}
                    aria-label={`Move ${meta.label} down`}
                  >
                    ↓
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Optional custom intro & footer copy */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Custom intro callout <span className="text-fg-muted/60">(supports {"{{vars}}"})</span></Label>
          <Input
            value={config.customIntro}
            onChange={(e) => update({ customIntro: e.target.value })}
            placeholder="Optional notice shown above summary…"
            className="text-xs"
          />
        </div>
        <div>
          <Label>Custom footer prefix <span className="text-fg-muted/60">(optional)</span></Label>
          <Input
            value={config.customFooter}
            onChange={(e) => update({ customFooter: e.target.value })}
            placeholder="e.g. Contoso SecOps · SOC Tier-1"
            className="text-xs"
          />
        </div>
      </div>
    </div>
  );
}
