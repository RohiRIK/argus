import { getSharedGraphClient, retryAfterMsFromError } from "@/services/graph/client";
import { withRetry } from "@/lib/retry";
import { DispatchError } from "@/lib/errors";

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
    if (message.to.length === 0) {
      throw new DispatchError("No recipients for email", { retryable: false });
    }
    const client = getSharedGraphClient();
    await withRetry(
      async () => {
        try {
          await client.api(`/users/${encodeURIComponent(message.from)}/sendMail`).post({
            message: {
              subject: message.subject,
              body: { contentType: "HTML", content: message.html },
              toRecipients: message.to.map((address) => ({ emailAddress: { address } })),
              ...(message.replyTo ? { replyTo: [{ emailAddress: { address: message.replyTo } }] } : {}),
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
  },
};
