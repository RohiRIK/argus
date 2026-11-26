import { createHash } from "node:crypto";
import {
  DEFAULT_SUBJECT,
  DEFAULT_TEMPLATE_HTML,
  DEFAULT_TEXT_TEMPLATE,
  LEGACY_CATEGORY_SUBJECT,
  LEGACY_SUBJECT,
  LEGACY_TEMPLATE_HTML,
  LEGACY_TEXT_TEMPLATE,
  SHARED_TEMPLATE_TYPE,
} from "./default-template";
import {
  AUTOMATION_DEFAULT_HTML,
  AUTOMATION_DEFAULT_SUBJECT,
  AUTOMATION_DEFAULT_TEXT,
  AUTOMATION_TEMPLATE_TYPE,
} from "./automation-template";

/**
 * Managed (Argus-owned) default template content + ownership hashing.
 *
 * A seeded default template is `managed` while its content still hashes to the
 * `sourceHash` it was seeded/upgraded from. `bun run db:seed` only ever upgrades
 * managed rows; operator edits flip the row to operator-owned for good (until an
 * explicit reset).
 */

export interface TemplateContent {
  subject: string;
  htmlBody: string;
  textBody: string | null;
}

/** The current shipped default for every report's seeded template. */
export const MANAGED_DEFAULT_CONTENT: TemplateContent = Object.freeze({
  subject: DEFAULT_SUBJECT,
  htmlBody: DEFAULT_TEMPLATE_HTML,
  textBody: DEFAULT_TEXT_TEMPLATE,
});

/** Stable content hash (sha256 hex) over subject / html / text. */
export function templateContentHash(content: TemplateContent): string {
  return createHash("sha256")
    .update(JSON.stringify([content.subject, content.htmlBody, content.textBody ?? null]))
    .digest("hex");
}

export const MANAGED_DEFAULT_HASH = templateContentHash(MANAGED_DEFAULT_CONTENT);

/** The shipped default for automation-run emails. */
export const AUTOMATION_DEFAULT_CONTENT: TemplateContent = Object.freeze({
  subject: AUTOMATION_DEFAULT_SUBJECT,
  htmlBody: AUTOMATION_DEFAULT_HTML,
  textBody: AUTOMATION_DEFAULT_TEXT,
});
export const AUTOMATION_DEFAULT_HASH = templateContentHash(AUTOMATION_DEFAULT_CONTENT);

/** Which shipped default a template row tracks, by its type (report types share one default). */
export function managedDefaultFor(reportType: string): { content: TemplateContent; hash: string } {
  return reportType === AUTOMATION_TEMPLATE_TYPE
    ? { content: AUTOMATION_DEFAULT_CONTENT, hash: AUTOMATION_DEFAULT_HASH }
    : { content: MANAGED_DEFAULT_CONTENT, hash: MANAGED_DEFAULT_HASH };
}

/** Template types that each have exactly one shared, Argus-managed default row. */
export const SHARED_DEFAULT_TYPES = [SHARED_TEMPLATE_TYPE, AUTOMATION_TEMPLATE_TYPE] as const;

/**
 * Every subject / html / text value Argus has ever seeded (current + legacy).
 * `null` text = rows seeded before the plain-text body existed (rendering falls
 * back to the default text template).
 */
const KNOWN_SUBJECTS = new Set<string>([DEFAULT_SUBJECT, LEGACY_SUBJECT, LEGACY_CATEGORY_SUBJECT]);
const KNOWN_HTML = new Set<string>([DEFAULT_TEMPLATE_HTML, LEGACY_TEMPLATE_HTML]);
const KNOWN_TEXT = new Set<string | null>([DEFAULT_TEXT_TEMPLATE, LEGACY_TEXT_TEMPLATE, null]);

/** True when every content field is an unmodified current or legacy Argus default. */
export function isKnownDefaultContent(content: TemplateContent): boolean {
  return (
    KNOWN_SUBJECTS.has(content.subject) &&
    KNOWN_HTML.has(content.htmlBody) &&
    KNOWN_TEXT.has(content.textBody ?? null)
  );
}
