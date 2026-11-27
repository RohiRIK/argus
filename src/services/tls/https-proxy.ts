/**
 * In-container HTTPS front for `next start`.
 *
 * Next listens on loopback only (127.0.0.1:<internal port>); this handler
 * terminates TLS on the public port and forwards each request there. It sets
 * the X-Forwarded-* headers itself (dropping any the client sent) so the app
 * sees the real public origin and marks session cookies Secure.
 */

const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
];

export interface ProxyOptions {
  /** e.g. "http://127.0.0.1:8180" */
  upstream: string;
  /** Add HSTS. Only for a CA-signed certificate: HSTS blocks click-through on a self-signed one. */
  hsts?: boolean;
  fetchImpl?: typeof fetch;
}

/** Rewrite absolute redirects that point at the internal origin or at plain http on the public host. */
export function rewriteLocation(location: string, publicOrigin: string, upstream: string): string {
  const pub = new URL(publicOrigin);
  if (location.startsWith(upstream)) return publicOrigin + location.slice(upstream.length);
  const httpPublic = `http://${pub.host}`;
  if (location === httpPublic || location.startsWith(`${httpPublic}/`)) {
    return publicOrigin + location.slice(httpPublic.length);
  }
  return location;
}

export function createHttpsProxy(opts: ProxyOptions) {
  const upstream = opts.upstream.replace(/\/+$/u, "");
  const doFetch = opts.fetchImpl ?? fetch;

  return async function handle(req: Request, clientIp?: string): Promise<Response> {
    const url = new URL(req.url);
    const publicOrigin = `https://${url.host}`;

    const headers = new Headers(req.headers);
    for (const h of HOP_BY_HOP) headers.delete(h);
    for (const h of [...headers.keys()]) {
      if (h.startsWith("x-forwarded-") || h === "forwarded") headers.delete(h);
    }
    headers.set("x-forwarded-proto", "https");
    headers.set("x-forwarded-host", url.host);
    if (clientIp) headers.set("x-forwarded-for", clientIp);

    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    let res: Response;
    try {
      res = await doFetch(`${upstream}${url.pathname}${url.search}`, {
        method: req.method,
        headers,
        body: hasBody ? req.body : undefined,
        redirect: "manual",
        // Bun: pass compressed bodies through untouched (content-encoding is kept).
        decompress: false,
        duplex: "half",
      } as RequestInit);
    } catch {
      return Response.json(
        { success: false, error: { code: "UpstreamUnavailable", message: "Argus is starting or restarting" } },
        { status: 502 },
      );
    }

    const out = new Headers(res.headers);
    for (const h of HOP_BY_HOP) out.delete(h);
    const location = out.get("location");
    if (location) out.set("location", rewriteLocation(location, publicOrigin, upstream));
    if (opts.hsts) out.set("strict-transport-security", "max-age=31536000");

    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
  };
}
