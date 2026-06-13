/**
 * Typed error taxonomy (spec §7). Each error carries an HTTP status and a
 * `retryable` flag the retry/degradation logic keys off. Messages are safe to
 * log; never put secrets in them.
 */

export abstract class ArgusError extends Error {
  abstract readonly status: number;
  abstract readonly retryable: boolean;
  readonly code: string;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
    this.code = this.constructor.name;
  }
}

export class ValidationError extends ArgusError {
  readonly status = 400;
  readonly retryable = false;
  readonly fields?: Record<string, string>;
  constructor(message: string, fields?: Record<string, string>) {
    super(message);
    this.fields = fields;
  }
}

export class NotFoundError extends ArgusError {
  readonly status = 404;
  readonly retryable = false;
}

export class VaultError extends ArgusError {
  readonly status = 500;
  readonly retryable = false;
}

export class GraphAuthError extends ArgusError {
  readonly status = 502;
  readonly retryable = true;
}

export class GraphApiError extends ArgusError {
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

export class DispatchError extends ArgusError {
  readonly status = 502;
  readonly retryable = true;
}

/** Narrow an unknown error to its retryable flag (defaults to false). */
export function isRetryable(err: unknown): boolean {
  return err instanceof ArgusError ? err.retryable : false;
}

/** Map any thrown value to an HTTP status (unknown → 500). */
export function statusOf(err: unknown): number {
  return err instanceof ArgusError ? err.status : 500;
}
