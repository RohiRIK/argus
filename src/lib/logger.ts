/**
 * Minimal structured logger. JSON lines in production (parseable by log
 * aggregators), human-readable in dev. Never log secrets.
 */
type Level = "info" | "warn" | "error";

function emit(level: Level, message: string, meta?: Record<string, unknown>) {
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, message, ...meta });
    (level === "error" ? console.error : console.log)(line);
  } else {
    (level === "error" ? console.error : console.log)(`[argus] ${level}: ${message}`, meta ?? "");
  }
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => emit("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => emit("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => emit("error", message, meta),
};
