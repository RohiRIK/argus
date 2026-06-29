"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type ToastTone = "info" | "success" | "danger";
interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastApi {
  push: (message: string, tone?: ToastTone) => void;
}

const ToastContext = React.createContext<ToastApi | null>(null);

/** Access the toaster. Throws if used outside <ToastProvider>. */
export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

const TONE: Record<ToastTone, string> = {
  info: "border-border bg-surface-elevated text-fg",
  success: "border-success/30 bg-surface-elevated text-fg",
  danger: "border-danger/40 bg-surface-elevated text-fg",
};
const DOT: Record<ToastTone, string> = {
  info: "bg-info",
  success: "bg-success",
  danger: "bg-danger",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const push = React.useCallback((message: string, tone: ToastTone = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            data-testid="toast"
            className={cn(
              "animate-scale-in pointer-events-auto flex w-full items-center gap-2.5 rounded-lg border px-4 py-2.5 text-sm shadow-elevated",
              TONE[t.tone],
            )}
          >
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[t.tone])} />
            <span className="min-w-0 flex-1">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
