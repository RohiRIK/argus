import { describe, test, expect, beforeEach } from "bun:test";

const {
  liveGraphTransport,
  retryAfterMsFromError,
  resetGraphClient,
  getSharedGraphClient,
  graphClientFactoryCalls,
  __setGraphClientForTests,
} = await import("../src/services/graph/client");

beforeEach(() => resetGraphClient());

describe("retryAfterMsFromError (AC-G4)", () => {
  test("reads an explicit numeric retryAfterMs", () => {
    expect(retryAfterMsFromError({ retryAfterMs: 2000 })).toBe(2000);
  });
  test("reads Headers-like .get('retry-after') as seconds → ms", () => {
    const headers = { get: (k: string) => (k === "retry-after" ? "2" : null) };
    expect(retryAfterMsFromError({ headers })).toBe(2000);
  });
  test("reads a plain header record", () => {
    expect(retryAfterMsFromError({ headers: { "retry-after": "3" } })).toBe(3000);
  });
  test("undefined when no hint present", () => {
    expect(retryAfterMsFromError({})).toBeUndefined();
    expect(retryAfterMsFromError(new Error("nope"))).toBeUndefined();
  });
});

describe("client reuse (AC-G1)", () => {
  test("the factory runs once across repeated calls", () => {
    resetGraphClient();
    const before = graphClientFactoryCalls();
    const a = getSharedGraphClient();
    const b = getSharedGraphClient();
    expect(a).toBe(b);
    expect(graphClientFactoryCalls()).toBe(before + 1);
  });
});

interface Page {
  value: number[];
  "@odata.nextLink"?: string;
}
function fakeClient(pages: Page[]): unknown {
  let i = 0;
  return { api: () => ({ get: async () => pages[i++] }) };
}

describe("pagination (AC-G2)", () => {
  test("follows @odata.nextLink and concatenates pages", async () => {
    __setGraphClientForTests(
      fakeClient([
        { value: [1, 2], "@odata.nextLink": "next1" },
        { value: [3], "@odata.nextLink": "next2" },
        { value: [4] },
      ]),
    );
    const page = await liveGraphTransport.get<number>("/x");
    expect(page.value).toEqual([1, 2, 3, 4]);
    expect(page.truncated).toBeFalsy();
  });

  test("caps at MAX_PAGES and flags truncation", async () => {
    const always = { api: () => ({ get: async () => ({ value: [1], "@odata.nextLink": "n" }) }) };
    __setGraphClientForTests(always);
    const page = await liveGraphTransport.get<number>("/y");
    expect(page.truncated).toBe(true);
    expect(page.value.length).toBe(50);
  });

  test("single page (no nextLink) returns once", async () => {
    __setGraphClientForTests(fakeClient([{ value: [9] }]));
    const page = await liveGraphTransport.get<number>("/z");
    expect(page.value).toEqual([9]);
  });
});

describe("$batch chunking (AC-G5)", () => {
  test("splits requests into chunks of <=20", async () => {
    const chunkSizes: number[] = [];
    const client = {
      api: () => ({
        post: async (body: { requests: { id: string }[] }) => {
          chunkSizes.push(body.requests.length);
          return { responses: body.requests.map((r) => ({ id: r.id, status: 200 })) };
        },
      }),
    };
    __setGraphClientForTests(client);
    const reqs = Array.from({ length: 45 }, (_, i) => ({
      id: String(i),
      method: "GET" as const,
      url: "/me",
    }));
    const res = await liveGraphTransport.batch!(reqs);
    expect(res).toHaveLength(45);
    expect(chunkSizes).toEqual([20, 20, 5]);
  });
});
