/**
 * Typed error taxonomy (spec §7). Each error carries an HTTP status and a
 * `retryable` flag the retry/degradation logic keys off. Messages are safe to
 * log; never put secrets in them.
 */

export abstract class ArgusError extends Error {
  abstract readonly status: number;
  abstract readonly retryable: boolean;
  /** Literal per subclass: constructor.name is mangled by the production minifier. */
  abstract readonly code: string;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export class ValidationError extends ArgusError {
  override name = "ValidationError";
  readonly code = "ValidationError";
  readonly status = 400;
  readonly retryable = false;
  readonly fields?: Record<string, string>;
  constructor(message: string, fields?: Record<string, string>) {
    super(message);
    this.fields = fields;
  }
}

export class UnauthorizedError extends ArgusError {
  override name = "UnauthorizedError";
  readonly code = "UnauthorizedError";
  readonly status = 401;
  readonly retryable = false;
}

export class NotFoundError extends ArgusError {
  override name = "NotFoundError";
  readonly code = "NotFoundError";
  readonly status = 404;
  readonly retryable = false;
}

export class VaultError extends ArgusError {
  override name = "VaultError";
  readonly code = "VaultError";
  readonly status = 500;
  readonly retryable = false;
}

export class GraphAuthError extends ArgusError {
  override name = "GraphAuthError";
  readonly code = "GraphAuthError";
  // Missing creds / misconfiguration — retrying won't help.
  readonly status = 502;
  readonly retryable = false;
}

export class GraphApiError extends ArgusError {
  override name = "GraphApiError";
  readonly code = "GraphApiError";
  readonly status = 502;
  readonly retryable: boolean;
  readonly graphStatus?: number;
  readonly requestId?: string;
  constructor(
    message: string,
    info?: { graphStatus?: number; requestId?: string; cause?: unknown },
  ) {
    super(message, { cause: info?.cause });
    this.graphStatus = info?.graphStatus;
    this.requestId = info?.requestId;
    // 429 + 5xx are transient; 4xx (other) are not.
    this.retryable =
      info?.graphStatus === 429 ||
      (info?.graphStatus !== undefined && info.graphStatus >= 500);
  }
}

export class ConflictError extends ArgusError {
  override name = "ConflictError";
  readonly code = "ConflictError";
  readonly status = 409;
  readonly retryable = false;
}

export class DispatchError extends ArgusError {
  override name = "DispatchError";
  readonly code = "DispatchError";
  readonly status = 502;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  constructor(
    message: string,
    options?: { retryable?: boolean; retryAfterMs?: number; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.retryable = options?.retryable ?? true;
    this.retryAfterMs = options?.retryAfterMs;
  }
}

/** Narrow an unknown error to its retryable flag (defaults to false). */
export function isRetryable(err: unknown): boolean {
  return err instanceof ArgusError ? err.retryable : false;
}

/** Map any thrown value to an HTTP status (unknown → 500). */
export function statusOf(err: unknown): number {
  return err instanceof ArgusError ? err.status : 500;
}
