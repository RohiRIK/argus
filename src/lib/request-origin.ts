/** Derive external origin behind a reverse proxy (X-Forwarded-Host/Proto), falling back to req.url. */
export function getPublicOrigin(req: Request): string {
  const fwdHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const fwdProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (fwdHost) {
    const proto = fwdProto || new URL(req.url).protocol.replace(":", "");
    return `${proto}://${fwdHost}`;
  }
  return new URL(req.url).origin;
}
