"use client";

import { useEffect, useState } from "react";
import { Label, Select } from "@/components/ui/primitives";

/** User-selectable palettes. The default lives in :root/.dark (no data-theme). */
export const THEMES = [
  { value: "graphite-amber", label: "Cobalt · Neutral" },
  { value: "slate-bone", label: "Slate · Bone" },
  { value: "carbon-coral", label: "Carbon · Coral" },
  { value: "ink-sky", label: "Ink · Sky" },
  { value: "paper-ink", label: "Paper · Ink" },
] as const;

export type ThemeValue = (typeof THEMES)[number]["value"];
const DEFAULT: ThemeValue = "graphite-amber";
const STORAGE_KEY = "argus-palette";

/** Apply a palette: default removes the attribute, others set data-theme. */
function applyTheme(value: ThemeValue) {
  const el = document.documentElement;
  if (value === DEFAULT) el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", value);
}

export function ThemePicker() {
  const [theme, setTheme] = useState<ThemeValue>(DEFAULT);

  // Hydrate from the attribute the pre-paint inline script already set.
  useEffect(() => {
    const current = (document.documentElement.getAttribute("data-theme") as ThemeValue) ?? DEFAULT;
    setTheme(THEMES.some((t) => t.value === current) ? current : DEFAULT);
  }, []);

  function onChange(value: ThemeValue) {
    setTheme(value);
    applyTheme(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* private mode / storage disabled — palette just won't persist */
    }
  }

  return (
    <div className="flex items-center justify-between">
      <div>
        <Label className="mb-0">Theme</Label>
        <p className="mt-1 text-[11px] text-fg-muted/60">Re-tints the canvas + accent. Layout is unchanged.</p>
      </div>
      <Select
        value={theme}
        onChange={(e) => onChange(e.target.value as ThemeValue)}
        data-testid="theme-picker"
        className="w-48"
      >
        {THEMES.map((t) => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </Select>
    </div>
  );
}
