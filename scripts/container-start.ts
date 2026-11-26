/**
 * Container entrypoint: serve Argus over HTTPS from inside the container.
 *
 *   PORT (8100)                public HTTPS listener (Bun.serve + TLS)
 *   ARGUS_INTERNAL_PORT (8180) `next start` on 127.0.0.1 only
 *
 * The certificate is self-signed on first boot (kept encrypted in the data
 * volume) unless ARGUS_TLS_CERT_FILE / ARGUS_TLS_KEY_FILE are provided.
 * ARGUS_TLS=off serves plain HTTP on PORT instead.
 */
import { dirname, resolve } from "node:path";
import { getEnv } from "../src/config/env";
import { ensureTlsCertificate } from "../src/services/tls/certificate";
import { createHttpsProxy } from "../src/services/tls/https-proxy";

const env = getEnv();
const log = (msg: string) => console.log(`[argus] ${msg}`);

function startNext(host: string, port: number) {
  return Bun.spawn(["bun", "--bun", "next", "start", "-H", host, "-p", String(port)], {
    stdio: ["inherit", "inherit", "inherit"],
    env: process.env,
  });
}

async function waitForHealth(url: string, child: ReturnType<typeof startNext>): Promise<void> {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`next start exited with code ${child.exitCode}`);
    try {
      // Also boots the scheduler (see GET /api/health) without waiting for a probe.
      if ((await fetch(url)).ok) return;
    } catch {
      // not listening yet
    }
    await Bun.sleep(500);
  }
  throw new Error("next start did not become healthy in 60s");
}

if (env.ARGUS_TLS === "off") {
  log(`ARGUS_TLS=off — serving plain HTTP on :${env.PORT}`);
  const child = startNext("0.0.0.0", env.PORT);
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => child.kill(sig));
  await waitForHealth(`http://127.0.0.1:${env.PORT}/api/health`, child).catch((e) => log(String(e)));
  process.exit(await child.exited);
}

const tls = ensureTlsCertificate({
  dataDir: dirname(resolve(env.ARGUS_DB_PATH)),
  hostNames: env.ARGUS_TLS_HOSTNAMES,
  certFile: env.ARGUS_TLS_CERT_FILE,
  keyFile: env.ARGUS_TLS_KEY_FILE,
});
log(`TLS certificate (${tls.source}) valid until ${tls.notAfter}`);
if (tls.names.length) log(`TLS names: ${tls.names.join(", ")}`);
log(`TLS SHA-256 fingerprint: ${tls.fingerprint256}`);

const upstream = `http://127.0.0.1:${env.ARGUS_INTERNAL_PORT}`;
const child = startNext("127.0.0.1", env.ARGUS_INTERNAL_PORT);
const handle = createHttpsProxy({ upstream, hsts: tls.source === "provided" });

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: env.PORT,
  tls: { cert: tls.certPem, key: tls.keyPem },
  idleTimeout: 120,
  fetch(req, srv) {
    return handle(req, srv.requestIP(req)?.address);
  },
});
log(`HTTPS listening on https://0.0.0.0:${server.port} → ${upstream}`);

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    child.kill(sig);
  });
}

waitForHealth(`${upstream}/api/health`, child)
  .then(() => log("ready"))
  .catch((e) => log(String(e)));

const code = await child.exited;
server.stop(true);
process.exit(code);
