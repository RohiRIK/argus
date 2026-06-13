/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  experimental: {
    // node-cron and the Graph SDK are server-only; keep them out of bundling.
    serverComponentsExternalPackages: ["node-cron", "@microsoft/microsoft-graph-client"],
  },
  // NOTE: `bun:sqlite` is intentionally NOT externalized here. It is loaded via
  // createRequire() at runtime (src/db/client.ts), which is opaque to webpack —
  // externalizing it makes webpack hoist a top-level require that breaks Next's
  // Node build worker. The app runs under Bun, which provides bun:sqlite.
};

export default nextConfig;
