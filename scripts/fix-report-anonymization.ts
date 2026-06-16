/**
 * One-off: turn OFF tenant report-name concealment so usage reports return real
 * site/user names instead of hashes. PATCH /admin/reportSettings.
 * Needs ReportSettings.ReadWrite.All on the app. Run: `bun scripts/fix-report-anonymization.ts`
 */
import { createGraphClient } from "../src/services/graph/client";

const client = createGraphClient();

const before = await client.api("/admin/reportSettings").get();
console.log("BEFORE:", JSON.stringify(before));

await client.api("/admin/reportSettings").patch({ displayConcealedNames: false });

const after = await client.api("/admin/reportSettings").get();
console.log("AFTER: ", JSON.stringify(after));
process.exit(0);
