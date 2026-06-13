/** @type {import('next').NextConfig} */
const nextConfig = {
  // NOT standalone: the SQLite driver is loaded via createRequire (invisible to
  // Next's dependency tracing), so we ship full node_modules and run `next start`
  // under Bun (`bun --bun next start`) instead. See Dockerfile.
  reactStrictMode: true,
  experimental: {
    // node-cron and the Graph SDK are server-only; keep them out of bundling.
    serverComponentsExternalPackages: ["node-cron", "@microsoft/microsoft-graph-client"],
    // Enable src/instrumentation.ts (scheduler boot).
    instrumentationHook: true,
  },
  // NOTE: `bun:sqlite` is intentionally NOT externalized here. It is loaded via
  // createRequire() at runtime (src/db/client.ts), which is opaque to webpack —
  // externalizing it makes webpack hoist a top-level require that breaks Next's
  // Node build worker. The app runs under Bun, which provides bun:sqlite.
};

export default nextConfig;
