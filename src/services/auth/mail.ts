import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { liveEmailTransport, type EmailTransport } from "@/services/dispatch/email";
import { effectiveSender } from "@/services/graph/capabilities";

/**
 * Transport for account emails (invitations, one-time passwords).
 *
 * Normally Graph sendMail from the configured sender mailbox. When ARGUS_MAIL_OUTBOX is
 * set (E2E tests, local development without a tenant), each message is written as a
 * JSON file to that directory instead of being sent. Never set it in production: the
 * files contain one-time passwords.
 */
export function accountMailTransport(): EmailTransport {
  const outbox = process.env.ARGUS_MAIL_OUTBOX?.trim();
  if (!outbox) return liveEmailTransport;
  return {
    async send(message) {
      mkdirSync(outbox, { recursive: true });
      const file = join(outbox, `${Date.now()}-${crypto.randomUUID()}.json`);
      writeFileSync(file, JSON.stringify(message), { mode: 0o600 });
    },
  };
}

/** Sender for account emails: the configured mailbox, or a placeholder when writing to the outbox. */
export function accountMailSender(): string | null {
  return effectiveSender().address ?? (process.env.ARGUS_MAIL_OUTBOX?.trim() ? "argus@localhost" : null);
}
