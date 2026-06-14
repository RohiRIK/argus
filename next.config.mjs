/** @type {import('next').NextConfig} */
const nextConfig = {
  // NOT standalone: the SQLite driver is loaded via createRequire (invisible to
  // Next's dependency tracing), so we ship full node_modules and run `next start`
  // under Bun (`bun --bun next start`) instead. See Dockerfile.
  reactStrictMode: true,
  // Hide the dev-only overlay badge so the local chrome matches production.
  devIndicators: false,
  // Next 16: top-level (was experimental.serverComponentsExternalPackages).
  // node-cron and the Graph SDK are server-only; keep them out of bundling.
  serverExternalPackages: ["node-cron", "@microsoft/microsoft-graph-client"],
  // NOTE: `bun:sqlite` is intentionally NOT externalized here. It is loaded via
  // createRequire() at runtime (src/db/client.ts), which is opaque to webpack —
  // externalizing it makes webpack hoist a top-level require that breaks Next's
  // Node build worker. The app runs under Bun, which provides bun:sqlite.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },
};

export default nextConfig;
