/**
 * Next.js instrumentation hook — runs once when the server process boots.
 * Starts the in-process cron scheduler. Guarded so it never runs in the Edge
 * runtime or during the build's data-collection phase (PRD §4.2 Cron Service).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { startScheduler } = await import("@/services/scheduler");
  try {
    const { scheduled, skipped } = startScheduler();
    // eslint-disable-next-line no-console
    console.log(`[argus] scheduler started: ${scheduled} scheduled, ${skipped} skipped`);
  } catch (err) {
    // Non-fatal: the app still serves requests and supports manual "Run Now".
    console.error("[argus] scheduler failed to start:", err);
  }
}
