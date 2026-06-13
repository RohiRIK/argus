import { NextResponse } from "next/server";
import { ArgusError, statusOf, ValidationError } from "./errors";
import { logger } from "./logger";

export interface ApiMeta {
  total?: number;
  page?: number;
  limit?: number;
}

/** Success envelope: { success: true, data, meta? }. */
export function ok<T>(data: T, meta?: ApiMeta): NextResponse {
  return NextResponse.json({ success: true, data, ...(meta ? { meta } : {}) });
}

/**
 * Error envelope: { success: false, error: { code, message, fields? } }.
 * Never leaks stack traces or secrets — only the typed code + safe message.
 */
export function fail(err: unknown): NextResponse {
  const status = statusOf(err);
  // Log unexpected (non-typed) errors server-side; the client only sees a safe
  // generic message. Typed ArgusErrors are expected and not noise-logged.
  if (!(err instanceof ArgusError)) {
    logger.error("unhandled error", { error: err instanceof Error ? err.stack : String(err) });
  }
  const code = err instanceof ArgusError ? err.code : "InternalError";
  const message =
    err instanceof ArgusError ? err.message : "An unexpected error occurred";
  const fields = err instanceof ValidationError ? err.fields : undefined;
  return NextResponse.json(
    { success: false, error: { code, message, ...(fields ? { fields } : {}) } },
    { status },
  );
}
