import { defineConfig } from "drizzle-kit";

const dbPath = process.env.ARGUS_DB_PATH ?? "./data/argus.db";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: dbPath,
  },
  verbose: true,
  strict: true,
});
