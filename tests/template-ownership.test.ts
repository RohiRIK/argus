import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-tpl-own-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { migrate } = await import("drizzle-orm/bun-sqlite/migrator");
const { getDb, getRawDb, closeDb } = await import("../src/db/client");
const { runMigrations } = await import("../src/db/migrate");
const { seed } = await import("../src/db/seed");
const { classifyTemplateOwnership } = await import("../src/db/template-ownership");
const { templatesDao, templateVersionsDao } = await import("../src/db/dao/templates");
const defaults = await import("../src/services/report-engine/default-template");
const { MANAGED_DEFAULT_HASH, templateContentHash, isKnownDefaultContent } = await import(
  "../src/services/report-engine/managed-template"
);
const templateDetailRoute = await import("../src/app/api/templates/[id]/route");
const templateResetRoute = await import("../src/app/api/templates/[id]/reset/route");
const templateRevertRoute = await import("../src/app/api/templates/[id]/versions/[versionId]/revert/route");
const templatesRoute = await import("../src/app/api/templates/route");

const OWNERSHIP_MIGRATION_IDX = 16;

/** Copy ./drizzle with the journal truncated before the ownership migration (pre-0016 schema). */
function preOwnershipMigrations(): string {
  const out = join(dir, "drizzle-pre");
  cpSync("./drizzle", out, { recursive: true });
  const journalPath = join(out, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ idx: number }> };
  journal.entries = journal.entries.filter((e) => e.idx < OWNERSHIP_MIGRATION_IDX);
  writeFileSync(journalPath, JSON.stringify(journal), "utf8");
  return out;
}

function insertLegacyRow(id: string, isDefault: boolean, subject: string, html: string, text: string | null): void {
  getRawDb()
    .query(
      "INSERT INTO templates (id, name, report_type, subject, html_body, text_body, is_default, language) VALUES (?, ?, ?, ?, ?, ?, ?, 'en')",
    )
    .run(id, `Legacy ${id}`, `legacy-${id}`, subject, html, text, isDefault ? 1 : 0);
}

const getRow = (id: string) => templatesDao.findById(id)!;
const json = (body: unknown) =>
  new Request("http://t", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(() => {
  // Start from a pre-0016 database holding rows the old seed would have written.
  migrate(getDb(), { migrationsFolder: preOwnershipMigrations() });
  insertLegacyRow("legacy-untouched", true, defaults.LEGACY_SUBJECT, defaults.LEGACY_TEMPLATE_HTML, defaults.LEGACY_TEXT_TEMPLATE);
  insertLegacyRow("legacy-null-text", true, defaults.LEGACY_CATEGORY_SUBJECT, defaults.LEGACY_TEMPLATE_HTML, null);
  insertLegacyRow("current-default", true, defaults.DEFAULT_SUBJECT, defaults.DEFAULT_TEMPLATE_HTML, defaults.DEFAULT_TEXT_TEMPLATE);
  insertLegacyRow("edited-default", true, defaults.LEGACY_SUBJECT, "<p>operator branding</p>", null);
  insertLegacyRow("custom-clone", false, defaults.DEFAULT_SUBJECT, defaults.DEFAULT_TEMPLATE_HTML, defaults.DEFAULT_TEXT_TEMPLATE);
  runMigrations();
});

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe("migration 0016 backfill classification", () => {
  test("known (current or legacy) seeded defaults become managed with the hash of their content", () => {
    for (const id of ["legacy-untouched", "legacy-null-text", "current-default"]) {
      const t = getRow(id);
      expect(t.managed).toBe(true);
      expect(t.sourceHash).toBe(templateContentHash(t));
    }
    expect(getRow("current-default").sourceHash).toBe(MANAGED_DEFAULT_HASH);
  });

  test("edited defaults and custom clones become operator-owned", () => {
    expect(getRow("edited-default").managed).toBe(false);
    expect(getRow("custom-clone").managed).toBe(false);
    expect(getRow("custom-clone").sourceHash).toBeNull();
  });

  test("classification is idempotent and only touches unclassified rows", () => {
    expect(classifyTemplateOwnership()).toEqual({ managed: 0, operatorOwned: 0 });
    // A row restored from an old backup (managed omitted → NULL) is classified on the next pass.
    templatesDao.create({
      name: "Restored",
      reportType: "restored",
      subject: defaults.DEFAULT_SUBJECT,
      htmlBody: defaults.DEFAULT_TEMPLATE_HTML,
      textBody: defaults.DEFAULT_TEXT_TEMPLATE,
      isDefault: true,
      language: "en",
    });
    expect(classifyTemplateOwnership()).toEqual({ managed: 1, operatorOwned: 0 });
  });

  test("known-default matcher requires every field to be an Argus default", () => {
    expect(
      isKnownDefaultContent({ subject: defaults.LEGACY_SUBJECT, htmlBody: defaults.DEFAULT_TEMPLATE_HTML, textBody: null }),
    ).toBe(true);
    expect(isKnownDefaultContent({ subject: "Mine", htmlBody: defaults.DEFAULT_TEMPLATE_HTML, textBody: null })).toBe(false);
  });
});

describe("ownership-aware seed (one shared template)", () => {
  test("retires per-report defaults: unedited ones are removed, edited ones become operator-owned clones", () => {
    const result = seed();
    expect(result.templates).toBe(2); // the shared report default + the automation-run default
    for (const id of ["legacy-untouched", "legacy-null-text", "current-default"]) {
      expect(templatesDao.findById(id)).toBeUndefined();
    }
    const edited = getRow("edited-default");
    expect(edited.isDefault).toBe(false);
    expect(edited.managed).toBe(false);
    expect(edited.htmlBody).toBe("<p>operator branding</p>");
    expect(getRow("custom-clone").managed).toBe(false);

    const shared = templatesDao.sharedDefault()!;
    expect(shared.reportType).toBe(defaults.SHARED_TEMPLATE_TYPE);
    expect(shared.managed).toBe(true);
    expect(shared.sourceHash).toBe(MANAGED_DEFAULT_HASH);
    expect(shared.htmlBody).toBe(defaults.DEFAULT_TEMPLATE_HTML);
  });

  test("seeding twice is idempotent (no new rows, upgrades, or versions)", () => {
    const rowsBefore = templatesDao.findAll().length;
    const versionsBefore = templatesDao.findAll().reduce((n, t) => n + templateVersionsDao.list(t.id).length, 0);
    const again = seed();
    expect(again.templates).toBe(0);
    expect(again.upgraded).toBe(0);
    expect(templatesDao.findAll().length).toBe(rowsBefore);
    const versionsAfter = templatesDao.findAll().reduce((n, t) => n + templateVersionsDao.list(t.id).length, 0);
    expect(versionsAfter).toBe(versionsBefore);
  });

  test("the unedited shared default is upgraded when the shipped default changes", () => {
    const def = templatesDao.sharedDefault()!;
    const old = { subject: "[Argus v0] {{reportName}}", htmlBody: "<p>v0 {{detailsTable}}</p>", textBody: "v0" };
    templatesDao.update(def.id, { ...old, sourceHash: templateContentHash(old) });

    expect(seed().upgraded).toBe(1);
    const upgraded = getRow(def.id);
    expect(upgraded.htmlBody).toBe(defaults.DEFAULT_TEMPLATE_HTML);
    expect(upgraded.sourceHash).toBe(MANAGED_DEFAULT_HASH);
    expect(templateVersionsDao.list(def.id)[0].htmlBody).toBe(old.htmlBody);
  });

  test("a name-only edit keeps the shared default managed", async () => {
    const def = templatesDao.sharedDefault()!;
    await templateDetailRoute.PUT(json({ name: "Shared (renamed)" }), ctx(def.id));
    expect(getRow(def.id).managed).toBe(true);
  });

  test("an operator edit through the API makes it operator-owned and seed leaves it alone", async () => {
    const def = templatesDao.sharedDefault()!;
    const res = await templateDetailRoute.PUT(json({ htmlBody: "<p>ours {{detailsTable}}</p>" }), ctx(def.id));
    expect(res.status).toBe(200);
    expect(getRow(def.id).managed).toBe(false);

    templatesDao.update(def.id, { sourceHash: "0".repeat(64) });
    const result = seed();
    expect(result.upgraded).toBe(0);
    expect(result.updatesAvailable).toBeGreaterThanOrEqual(1);
    expect(getRow(def.id).htmlBody).toBe("<p>ours {{detailsTable}}</p>");
    // Still the one shared default — seed does not create a second one.
    expect(templatesDao.findAll().filter((t) => t.isDefault && t.reportType === defaults.SHARED_TEMPLATE_TYPE)).toHaveLength(1);
  });

  test("reset makes the shared default managed again; version revert makes it operator-owned", async () => {
    const def = templatesDao.sharedDefault()!;
    const reset = await templateResetRoute.POST(new Request("http://t", { method: "POST" }), ctx(def.id));
    expect(reset.status).toBe(200);
    const afterReset = getRow(def.id);
    expect(afterReset.managed).toBe(true);
    expect(afterReset.sourceHash).toBe(MANAGED_DEFAULT_HASH);
    expect(afterReset.htmlBody).toBe(defaults.DEFAULT_TEMPLATE_HTML);

    const prior = templateVersionsDao.list(def.id).find((v) => v.htmlBody.startsWith("<p>ours"))!;
    const revert = await templateRevertRoute.POST(new Request("http://t", { method: "POST" }), {
      params: Promise.resolve({ id: def.id, versionId: prior.id }),
    });
    expect(revert.status).toBe(200);
    expect(getRow(def.id).managed).toBe(false);
    expect(getRow(def.id).htmlBody).toBe(prior.htmlBody);
  });

  test("a managed row whose content drifted outside the API is detached, not overwritten", async () => {
    const def = templatesDao.sharedDefault()!;
    await templateResetRoute.POST(new Request("http://t", { method: "POST" }), ctx(def.id));
    getRawDb().query("UPDATE templates SET html_body = ? WHERE id = ?").run("<p>restored edit</p>", def.id);
    seed();
    const t = getRow(def.id);
    expect(t.managed).toBe(false);
    expect(t.htmlBody).toBe("<p>restored edit</p>");
  });

  test("API-created templates are operator-owned and reset keeps clones operator-owned", async () => {
    const res = await templatesRoute.POST(
      new Request("http://t", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Clone", reportType: "risky-users", subject: "S", htmlBody: "<p>c</p>" }),
      }),
    );
    const body = (await res.json()) as { data: { id: string; managed: boolean } };
    expect(body.data.managed).toBe(false);
    await templateResetRoute.POST(new Request("http://t", { method: "POST" }), ctx(body.data.id));
    expect(getRow(body.data.id).managed).toBe(false);
  });
});
