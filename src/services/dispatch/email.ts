import { getSharedGraphClient, retryAfterMsFromError } from "@/services/graph/client";
import { withRetry } from "@/lib/retry";
import { DispatchError } from "@/lib/errors";

const MAX_RECIPIENTS_PER_CALL = 450;

export interface EmailMessage {
  from: string; // shared mailbox UPN
  to: string[];
  subject: string;
  html: string;
  replyTo?: string; // optional Reply-To address (FR-3)
}

/** Pluggable email transport — live uses Graph sendMail; tests inject a fake. */
export interface EmailTransport {
  send(message: EmailMessage, options?: { sleep?: (ms: number) => Promise<void> }): Promise<void>;
}

/** Graph sendMail from the scoped shared mailbox (PRD §4.2, least-privilege). */
export const liveEmailTransport: EmailTransport = {
  async send(message: EmailMessage, options?: { sleep?: (ms: number) => Promise<void> }): Promise<void> {
    const from = message.from.trim();
    if (!from) {
      throw new DispatchError("Sender mailbox (from) is required", { retryable: false });
    }
    if (message.to.length === 0) {
      throw new DispatchError("No recipients for email", { retryable: false });
    }

    const safeSubject = message.subject.replace(/[\r\n]+/g, " ").trim().slice(0, 300) || "[Argus] Report";
    const client = getSharedGraphClient();

    for (let i = 0; i < message.to.length; i += MAX_RECIPIENTS_PER_CALL) {
      const batch = message.to.slice(i, i + MAX_RECIPIENTS_PER_CALL);
      await withRetry(
        async () => {
          try {
            await client.api(`/users/${encodeURIComponent(from)}/sendMail`).post({
              message: {
                subject: safeSubject,
                body: { contentType: "HTML", content: message.html },
                toRecipients: batch.map((address) => ({ emailAddress: { address } })),
                ...(message.replyTo ? { replyTo: [{ emailAddress: { address: message.replyTo } }] } : {}),
                internetMessageHeaders: [{ name: "Auto-Submitted", value: "auto-generated" }],
              },
              saveToSentItems: false,
            });
          } catch (err) {
            const status = (err as { statusCode?: number }).statusCode;
            const retryable = status === undefined || status === 408 || status === 429 || status >= 500;
            throw new DispatchError(`sendMail failed (${status ?? "?"})`, {
              retryable,
              retryAfterMs: retryAfterMsFromError(err),
              cause: err,
            });
          }
        },
        { sleep: options?.sleep },
      );
    }
  },
};
