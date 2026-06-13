/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  experimental: {
    // bun:sqlite, node-cron, and the crypto vault are server-only. Keep them out of
    // the client bundle and don't try to bundle native bindings.
    serverComponentsExternalPackages: ["node-cron", "@microsoft/microsoft-graph-client"],
  },
};

export default nextConfig;
