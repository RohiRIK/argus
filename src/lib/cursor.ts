import { ValidationError } from "./errors";

/**
 * Opaque keyset cursor for list endpoints: base64url-encoded JSON of the last
 * row's (timestamp, id). Clients must treat it as an opaque string.
 */
export interface KeysetCursor {
  timestamp: string;
  id: string;
}

export function encodeCursor(c: KeysetCursor): string {
  return Buffer.from(JSON.stringify([c.timestamp, c.id]), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): KeysetCursor {
  try {
    const v: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "string") {
      return { timestamp: v[0], id: v[1] };
    }
  } catch {
    // fall through
  }
  throw new ValidationError("Invalid cursor", { cursor: "Malformed or expired cursor" });
}
