"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: "Navigate" | "Actions";
  run: () => void;
}

/** Fuzzy subsequence match — "dsh" matches "Dashboard". Returns score (lower = better). */
function fuzzy(query: string, target: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let ti = 0;
  let score = 0;
  let lastHit = -1;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    if (lastHit >= 0) score += found - lastHit; // reward adjacency
    lastHit = found;
    ti = found + 1;
  }
  return score + (t.startsWith(q) ? -5 : 0);
}

/**
 * ⌘K / Ctrl-K command palette — keyboard-first navigation + key actions.
 * Mounted once in the app shell. Opens on the shortcut, closes on Esc / select /
 * backdrop. Arrow keys move the active row; Enter runs it.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const commands = React.useMemo<Command[]>(() => {
    const go = (href: string) => () => {
      setOpen(false);
      router.push(href);
    };
    const toggleTheme = () => {
      setOpen(false);
      const el = document.documentElement;
      const next = !el.classList.contains("dark");
      el.classList.toggle("dark", next);
      localStorage.setItem("argus-theme", next ? "dark" : "light");
    };
    return [
      { id: "nav-dashboard", label: "Dashboard", group: "Navigate", run: go("/dashboard") },
      { id: "nav-catalog", label: "Catalog", group: "Navigate", run: go("/catalog") },
      { id: "nav-logs", label: "Logs", group: "Navigate", run: go("/logs") },
      { id: "nav-templates", label: "Templates", group: "Navigate", run: go("/templates") },
      { id: "nav-settings", label: "Settings", group: "Navigate", run: go("/settings") },
      { id: "act-new-job", label: "New job", hint: "Browse catalog", group: "Actions", run: go("/catalog") },
      { id: "act-theme", label: "Toggle dark / light", group: "Actions", run: toggleTheme },
    ];
  }, [router]);

  const results = React.useMemo(() => {
    return commands
      .map((c) => ({ c, score: fuzzy(query, c.label + " " + (c.hint ?? "")) }))
      .filter((r): r is { c: Command; score: number } => r.score !== null)
      .sort((a, b) => a.score - b.score)
      .map((r) => r.c);
  }, [commands, query]);

  // Open on ⌘K / Ctrl-K from anywhere.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  React.useEffect(() => setActive(0), [query]);

  if (!open) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      results[active]?.run();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <button aria-label="Close" className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="animate-scale-in relative w-full max-w-lg overflow-hidden rounded-lg border border-border bg-surface-elevated shadow-elevated-lg" data-testid="command-palette">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search commands…"
          data-testid="command-input"
          className="w-full border-b border-border/60 bg-transparent px-4 py-3.5 text-sm text-fg placeholder:text-fg-muted/60 focus:outline-none"
        />
        <ul className="max-h-80 overflow-auto p-1.5">
          {results.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-fg-muted">No commands match.</li>
          ) : (
            results.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => c.run()}
                  data-testid={`cmd-${c.id}`}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                    i === active ? "bg-primary/10 text-fg" : "text-fg-muted hover:bg-surface-2",
                  )}
                >
                  <span className="text-fg">{c.label}</span>
                  <span className="text-[10px] uppercase tracking-wider text-fg-muted/60">{c.hint ?? c.group}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
