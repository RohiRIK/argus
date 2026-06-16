import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ArgusEmptyArt } from "@/components/icons";

/* ── Button ─────────────────────────────────────────────────────────────── */
const BTN_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]";

// Darkroom editorial: outlined ghost only — no filled chromatic backgrounds.
const BTN_VARIANT = {
  primary:
    "border border-fg/80 bg-transparent text-fg hover:border-accent hover:text-accent",
  secondary:
    "border border-border bg-transparent text-fg hover:border-fg/60",
  outline:
    "border border-border bg-transparent text-fg hover:border-fg/60",
  ghost:
    "text-fg-muted hover:text-fg",
  danger:
    "border border-danger/70 bg-transparent text-danger hover:bg-danger/10",
} as const;

const BTN_SIZE = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-10 px-5 text-sm",
  icon: "h-9 w-9",
} as const;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof BTN_VARIANT;
  size?: keyof typeof BTN_SIZE;
}

export function Button({ className, variant = "primary", size = "md", ...props }: ButtonProps) {
  return <button className={cn(BTN_BASE, BTN_VARIANT[variant], BTN_SIZE[size], className)} {...props} />;
}

export function LinkButton({
  href,
  className,
  variant = "secondary",
  size = "md",
  children,
  ...props
}: {
  href: string;
  className?: string;
  variant?: keyof typeof BTN_VARIANT;
  size?: keyof typeof BTN_SIZE;
  children: React.ReactNode;
} & Omit<React.ComponentProps<typeof Link>, "href" | "className">) {
  return (
    <Link href={href} className={cn(BTN_BASE, BTN_VARIANT[variant], BTN_SIZE[size], className)} {...props}>
      {children}
    </Link>
  );
}

/* ── Card ──────────────────────────────────────────────────────────────────── */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "border border-border/60 bg-transparent transition-colors duration-200",
        className,
      )}
      {...props}
    />
  );
}

export function CardHover({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "border border-border/60 bg-transparent transition-colors duration-200 hover:border-accent/70",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-border/50 px-5 py-4",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-semibold tracking-tight text-fg", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs text-fg-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}

/* ── Badge ────────────────────────────────────────────────────────────────── */
export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-border/40 bg-surface-2/80 px-2 py-0.5 text-[10px] font-medium text-fg-muted",
        className,
      )}
      {...props}
    />
  );
}

export function BadgeCategory({ category, className }: { category: string; className?: string }) {
  const tones: Record<string, string> = {
    identity: "bg-info/10 text-info border-info/20",
    security: "bg-danger/10 text-danger border-danger/20",
    infrastructure: "bg-success/10 text-success border-success/20",
    custom: "bg-accent/10 text-accent border-accent/20",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider border",
        tones[category] ?? "bg-surface-2 text-fg-muted border-border/40",
        className,
      )}
    >
      {category}
    </span>
  );
}

/* ── Inputs ───────────────────────────────────────────────────────────────── */
const FIELD =
  "w-full rounded-lg border border-border/70 bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-muted/50 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary/50";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(FIELD, className)} {...props} />;
  },
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(FIELD, "min-h-[120px] font-mono text-xs leading-relaxed", className)} {...props} />;
  },
);

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return <select ref={ref} className={cn(FIELD, "cursor-pointer", className)} {...props} />;
  },
);

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-xs font-medium text-fg", className)} {...props} />;
}

/* ── Table ────────────────────────────────────────────────────────────────── */
export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto border border-border/60">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}
export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "border-b border-border/50 bg-surface-2/50 px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-fg-muted",
        className,
      )}
      {...props}
    />
  );
}
export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-border/40 px-4 py-2.5 text-sm", className)} {...props} />;
}

/* ── Segmented control ──────────────────────────────────────────────────── */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex rounded-lg border border-border/60 bg-surface-2 p-0.5", className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          data-testid={`seg-${o.value}`}
          onClick={() => onChange(o.value)}
          className={cn(
            "px-3 py-1 text-xs font-medium transition-colors duration-200",
            value === o.value
              ? "border border-border bg-surface-2 text-fg"
              : "text-fg-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── Skeleton / Empty ───────────────────────────────────────────────────── */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-lg bg-surface-2/70",
        className,
      )}
    />
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-grid flex flex-col items-center justify-center border border-dashed border-border/60 bg-surface/30 px-6 py-16 text-center">
      <ArgusEmptyArt className="mb-5 h-28 w-28 opacity-80" />
      <p className="text-sm font-semibold text-fg">{title}</p>
      {hint && <p className="mt-1.5 max-w-sm text-xs text-fg-muted leading-relaxed">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
