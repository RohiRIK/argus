import { expect, test, describe, afterEach } from "bun:test";
import { liveEmailTransport, type EmailMessage, type EmailTransport } from "../src/services/dispatch/email";
import { __setGraphClientForTests, resetGraphClient } from "../src/services/graph/client";
import { DispatchError } from "../src/lib/errors";

afterEach(() => resetGraphClient());

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

  test("rejects an empty sender address before any network call (DispatchError)", async () => {
    await expect(liveEmailTransport.send(msg({ from: "   " }))).rejects.toBeInstanceOf(DispatchError);
  });

  test("does not retry permanent 403 errors", async () => {
    let calls = 0;
    __setGraphClientForTests({
      api: () => ({
        post: async () => {
          calls++;
          throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
        },
      }),
    });
    await expect(liveEmailTransport.send(msg({}), { sleep: async () => {} })).rejects.toBeInstanceOf(DispatchError);
    expect(calls).toBe(1);
  });

  test("retries transient 503 errors via shared Graph client", async () => {
    let calls = 0;
    __setGraphClientForTests({
      api: () => ({
        post: async () => {
          calls++;
          if (calls < 3) throw Object.assign(new Error("Unavailable"), { statusCode: 503 });
          return {};
        },
      }),
    });
    await liveEmailTransport.send(msg({}), { sleep: async () => {} });
    expect(calls).toBe(3);
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
