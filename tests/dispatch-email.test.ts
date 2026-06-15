import { expect, test, describe } from "bun:test";
import { liveEmailTransport, type EmailMessage, type EmailTransport } from "../src/services/dispatch/email";
import { DispatchError } from "../src/lib/errors";

const msg = (over: Partial<EmailMessage>): EmailMessage => ({
  from: "shared@x.com",
  to: ["a@x.com"],
  subject: "S",
  html: "<p>hi</p>",
  ...over,
});

describe("liveEmailTransport", () => {
  test("rejects an empty recipient list before any network call (DispatchError)", async () => {
    await expect(liveEmailTransport.send(msg({ to: [] }))).rejects.toBeInstanceOf(DispatchError);
  });
});

describe("EmailTransport contract", () => {
  test("a fake transport receives the exact message (injection seam)", async () => {
    const captured: EmailMessage[] = [];
    const fake: EmailTransport = {
      async send(m) {
        captured.push(m);
      },
    };
    const m = msg({ to: ["x@y.com"], replyTo: "noreply@x.com" });
    await fake.send(m);
    expect(captured[0]).toEqual(m);
  });
});
