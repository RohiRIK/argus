import { describe, test, expect } from "bun:test";
import {
  buildSharedMailboxScript,
  listTenantMailboxes,
  sendMailboxVerificationEmail,
  verifyMailbox,
} from "../src/services/graph/mailboxes";
import type { EmailMessage } from "../src/services/dispatch/email";

function makeClient(users: Array<{ id: string; displayName: string; mail?: string; userPrincipalName: string; assignedLicenses?: unknown[] }>) {
  return {
    api(path: string) {
      return {
        select() {
          return {
            top() {
              return {
                async get() {
                  if (path === "/users") return { value: users };
                  return {};
                },
              };
            },
            async get() {
              if (path.startsWith("/users/")) {
                const key = decodeURIComponent(path.slice("/users/".length)).toLowerCase();
                const hit = users.find(
                  (u) =>
                    u.userPrincipalName.toLowerCase() === key ||
                    (u.mail ?? "").toLowerCase() === key,
                );
                if (!hit) throw Object.assign(new Error("Request_ResourceNotFound"), { statusCode: 404 });
                return hit;
              }
              return {};
            },
          };
        },
        top() {
          return { async get() { return { value: users }; } };
        },
        async get() {
          return {};
        },
      };
    },
  };
}

describe("graph mailbox services", () => {
  test("listTenantMailboxes filters external guests, dedupes, and flags license state", async () => {
    const client = makeClient([
      {
        id: "u1",
        displayName: "Admin",
        mail: "admin@contoso.com",
        userPrincipalName: "admin@contoso.com",
        assignedLicenses: [{ skuId: "s1" }],
      },
      {
        id: "u2",
        displayName: "Argus Shared",
        mail: "argus@contoso.com",
        userPrincipalName: "argus@contoso.com",
        assignedLicenses: [],
      },
      {
        id: "g1",
        displayName: "Guest",
        mail: "ext@partner.com",
        userPrincipalName: "ext_partner.com#EXT#@contoso.onmicrosoft.com",
      },
    ]);

    const res = await listTenantMailboxes({ client });
    expect(res).toHaveLength(2);
    expect(res.find((m) => m.address === "admin@contoso.com")?.hasLicense).toBe(true);
    expect(res.find((m) => m.address === "argus@contoso.com")?.hasLicense).toBe(false);
  });

  test("verifyMailbox detects present mailbox and returns false cleanly on 404", async () => {
    const client = makeClient([
      {
        id: "u2",
        displayName: "Argus Shared",
        mail: "argus@contoso.com",
        userPrincipalName: "argus@contoso.com",
        assignedLicenses: [],
      },
    ]);

    const found = await verifyMailbox("argus@contoso.com", { client });
    expect(found.exists).toBe(true);
    expect(found.address).toBe("argus@contoso.com");
    expect(found.hasLicense).toBe(false);

    const missing = await verifyMailbox("nobody@contoso.com", { client });
    expect(missing.exists).toBe(false);
    expect(missing.note).toContain("not found");
  });

  test("buildSharedMailboxScript includes shared mailbox creation + Application Mail.Send RBAC", () => {
    const ps = buildSharedMailboxScript({
      address: "argus@contoso.com",
      displayName: "Argus Reports",
      appId: "11111111-1111-4111-8111-111111111111",
      appDisplayName: "Argus M365",
    });
    expect(ps).toContain("New-Mailbox -Shared");
    expect(ps).toContain("PrimarySmtpAddress $mailbox");
    expect(ps).toContain("Application Mail.Send");
    expect(ps).toContain("New-ManagementScope");
    expect(ps).toContain("11111111-1111-4111-8111-111111111111");
  });

  test("sendMailboxVerificationEmail dispatches via injected transport", async () => {
    const sent: EmailMessage[] = [];
    await sendMailboxVerificationEmail(
      { from: "argus@contoso.com", to: "admin@contoso.com", orgName: "Contoso" },
      { transport: { async send(m) { sent.push(m); } } },
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].from).toBe("argus@contoso.com");
    expect(sent[0].to).toEqual(["admin@contoso.com"]);
    expect(sent[0].html).toContain("Contoso");
  });
});
