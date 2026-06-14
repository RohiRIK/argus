# Database Layer

## Overview

SQLite + Drizzle ORM. Singleton connection (lazy, WAL mode, FK enforcement). 8 tables, 7 DAOs.

## Structure

| File | Purpose |
|------|---------|
| `client.ts` | Singleton `getDb()` — lazy open, WAL pragmas, `runtimeRequire` for bun:sqlite |
| `schema.ts` | 8 table definitions + inferred TS types |
| `migrate.ts` | Migration runner (CLI) |
| `seed.ts` | Seeds 12 default reports + default Entra ID integration |
| `dao/` | 7 DAO files (one per table) |

## DAO Pattern

Each DAO exports a plain object with methods:

```
{name}Dao.findAll()     → T[]
{name}Dao.findById(id)  → T | undefined
{name}Dao.create(input) → T
{name}Dao.update(id, patch) → T | undefined
{name}Dao.delete(id)    → void
```

Additional query methods per DAO (e.g., `jobsDao.active()`, `executionsDao.forJob()`).

## Conventions

- PKs are UUIDv4 strings (app-generated, not autoincrement)
- JSON columns use `text({ mode: "json" })` with `$type<T>` for type safety
- Timestamps are ISO-8601 UTC strings — `createdAt`/`updatedAt` default to `now`
- `executions` and `logs` are append-only (no update/delete)
- `finalize()` on executions writes execution + logs in a single transaction
