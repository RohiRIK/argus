"use client";

import { useEffect, useState } from "react";

/** Format a timestamp as a compact, scannable relative string ("2h ago", "just now"). */
function formatRelative(from: Date, now: Date): string {
  const diffMs = now.getTime() - from.getTime();
  const future = diffMs < 0;
  const s = Math.round(Math.abs(diffMs) / 1000);
  const m = Math.round(s / 60);
  const h = Math.round(m / 60);
  const d = Math.round(h / 24);
  let body: string;
  if (s < 45) body = "just now";
  else if (m < 60) body = `${m}m`;
  else if (h < 24) body = `${h}h`;
  else if (d < 30) body = `${d}d`;
  else return from.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  if (body === "just now") return body;
  return future ? `in ${body}` : `${body} ago`;
}

/**
 * Relative timestamp ("2h ago") with the absolute time on hover (title).
 *
 * Renders the absolute string on the server / first paint to avoid a hydration
 * mismatch, then upgrades to relative after mount. `data-testid="relative-time"`
 * keeps it in the VR mask set (it changes run-to-run).
 */
export function RelativeTime({ iso, className }: { iso: string | null; className?: string }) {
  const [rel, setRel] = useState<string | null>(null);

  useEffect(() => {
    if (!iso) return;
    const from = new Date(iso);
    const tick = () => setRel(formatRelative(from, new Date()));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [iso]);

  if (!iso) return <span className={className}>never</span>;

  const absolute = new Date(iso).toLocaleString();
  return (
    <time
      dateTime={iso}
      title={absolute}
      data-testid="relative-time"
      className={className}
      suppressHydrationWarning
    >
      {rel ?? absolute}
    </time>
  );
}
