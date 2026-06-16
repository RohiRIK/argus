import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * AC-UI19 — body-muted text must meet WCAG AA (≥4.5:1) on the canvas, in both
 * light and dark. Reads the real tokens from globals.css so the assertion tracks
 * the source of truth. P2 extends this to all 5 themes (the helpers are reused).
 */

const css = readFileSync(join(import.meta.dir, "../src/app/globals.css"), "utf8");

/** Pull `--name: H S% L%;` from a CSS block; returns [h, s, l]. */
function hsl(block: string, name: string): [number, number, number] {
  const m = block.match(new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
  if (!m) throw new Error(`token --${name} not found`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Extract the body of the first `selector { ... }` rule. */
function rule(selector: string): string {
  const i = css.indexOf(selector);
  if (i === -1) throw new Error(`selector ${selector} not found`);
  const open = css.indexOf("{", i);
  const close = css.indexOf("}", open);
  return css.slice(open, close);
}

function srgbToLinear(c: number): number {
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance from an HSL triplet (H deg, S%, L%). */
function luminance([h, s, l]: [number, number, number]): number {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const [r, g, b] = [f(0), f(8), f(4)].map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: [number, number, number], bg: [number, number, number]): number {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

describe("AC-UI19/AC-TH5 — muted text contrast across all themes (WCAG AA)", () => {
  const ALT_THEMES = ["slate-bone", "carbon-coral", "ink-sky", "paper-ink"];
  const modes: { name: string; selector: string }[] = [
    // Default palette lives in :root/.dark.
    { name: "graphite-amber light", selector: ":root {" },
    { name: "graphite-amber dark", selector: ".dark {" },
    // Alternate palettes are scoped per mode.
    ...ALT_THEMES.flatMap((t) => [
      { name: `${t} light`, selector: `html:not(.dark)[data-theme="${t}"] {` },
      { name: `${t} dark`, selector: `html.dark[data-theme="${t}"] {` },
    ]),
  ];

  for (const { name, selector } of modes) {
    test(`${name}: --fg-muted on --bg ≥ 4.5:1`, () => {
      const block = rule(selector);
      const ratio = contrast(hsl(block, "fg-muted"), hsl(block, "bg"));
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  }
});
