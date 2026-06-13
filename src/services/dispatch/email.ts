import { createGraphClient } from "@/services/graph/client";
import { withRetry } from "@/lib/retry";
import { DispatchError } from "@/lib/errors";

export interface EmailMessage {
  from: string; // shared mailbox UPN
  to: string[];
  subject: string;
  html: string;
}

/** Pluggable email transport — live uses Graph sendMail; tests inject a fake. */
export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
}

/** Graph sendMail from the scoped shared mailbox (PRD §4.2, least-privilege). */
export const liveEmailTransport: EmailTransport = {
  async send(message: EmailMessage): Promise<void> {
    if (message.to.length === 0) throw new DispatchError("No recipients for email");
    const client = createGraphClient();
    await withRetry(async () => {
      try {
        await client.api(`/users/${encodeURIComponent(message.from)}/sendMail`).post({
          message: {
            subject: message.subject,
            body: { contentType: "HTML", content: message.html },
            toRecipients: message.to.map((address) => ({ emailAddress: { address } })),
          },
          saveToSentItems: false,
        });
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        throw new DispatchError(`sendMail failed (${status ?? "?"})`, { cause: err });
      }
    });
  },
};
