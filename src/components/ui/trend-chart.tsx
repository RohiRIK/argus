/**
 * Per-job count-over-time line chart (spec-trend-dashboard). Pure SVG, server
 * rendered, no chart library — matches the in-house SVG / darkroom-editorial
 * design system. Plots the primary metric across a job's recent runs.
 */

export interface TrendPoint {
  value: number;
  status: string;
  iso: string;
  id: string;
}

interface TrendChartProps {
  /** Chronological, oldest → newest. */
  points: TrendPoint[];
  /** Execution to highlight (the one being viewed). */
  currentId?: string;
  label?: string;
}

const VIEW_W = 600;
const VIEW_H = 120;
const PAD = 12;

export interface PlotCoord {
  x: number;
  y: number;
}

/**
 * Map values to viewBox coordinates. Y is auto-scaled to [0, max]; a flat series
 * (all equal) centers vertically; a single point sits mid-width. Pure — unit-tested.
 */
export function plotPoints(values: number[], w = VIEW_W, h = VIEW_H, pad = PAD): PlotCoord[] {
  const n = values.length;
  if (n === 0) return [];
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const max = Math.max(...values);
  const min = Math.min(0, ...values); // anchor baseline at 0 so magnitude reads true
  const span = max - min || 1; // flat series → avoid divide-by-zero
  return values.map((v, i) => {
    const x = n === 1 ? w / 2 : pad + (i / (n - 1)) * innerW;
    const y = max === min ? h / 2 : pad + innerH - ((v - min) / span) * innerH;
    return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
  });
}

export function TrendChart({ points, currentId, label }: TrendChartProps) {
  if (points.length === 0) return null;
  const values = points.map((p) => p.value);
  const coords = plotPoints(values);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const latest = values[values.length - 1];
  const polyline = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const ariaLabel =
    label ?? `Trend over ${points.length} runs: min ${min}, max ${max}, latest ${latest}`;

  return (
    <div className="rounded-lg border border-border/70 bg-surface p-4 shadow-sm">
      <div className="mb-2.5 flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wider text-fg-muted/60">Count over time</p>
        <p className="font-mono text-xs text-fg-muted/80 tabular-nums">
          {min}–{max} · now {latest}
        </p>
      </div>
      {/* The line is drawn in SVG and stretched to fill width (preserveAspectRatio
          none + non-scaling stroke). Markers are percentage-positioned HTML dots
          over it so they stay perfectly round at any width — an SVG <circle> would
          smear into an ellipse under the non-uniform stretch. */}
      <div className="relative h-24 w-full" role="img" aria-label={ariaLabel}>
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full text-accent"
          aria-hidden="true"
        >
          <line
            x1={PAD}
            y1={VIEW_H - PAD}
            x2={VIEW_W - PAD}
            y2={VIEW_H - PAD}
            className="stroke-border"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {coords.length > 1 && (
            <polyline
              points={polyline}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {coords.map((c, i) => {
          const isCurrent = points[i].id === currentId;
          return (
            <span
              key={points[i].id}
              title={`${points[i].value} · ${new Date(points[i].iso).toLocaleString()}`}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ${
                isCurrent
                  ? "h-2.5 w-2.5 bg-accent ring-2 ring-accent/30"
                  : "h-1.5 w-1.5 bg-fg-muted"
              }`}
              style={{ left: `${(c.x / VIEW_W) * 100}%`, top: `${(c.y / VIEW_H) * 100}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}
