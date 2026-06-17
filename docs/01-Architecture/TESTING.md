# Testing Strategy

> **Location:** `tests/` (unit/integration), `e2e/` (Playwright)
> **Runner:** `bun test`
> **Target:** 80% minimum coverage

---

## Overview

Argus uses two testing layers:

1. **Unit/Integration tests** (`tests/`) — 35 test files covering services, DAOs, API routes
2. **E2E tests** (`e2e/`) — Playwright browser tests for user flows

---

## Unit/Integration Tests

### Location

`tests/` — one file per module, co-located at project root.

### Test Files

| File | Covers |
|------|--------|
| `vault.test.ts` | Vault encryption/decryption |
| `db.test.ts` | Database client, PRAGMAs, schema |
| `baselines-dao.test.ts` | Baseline recording and history |
| `executor.test.ts` | Full job execution pipeline |
| `scheduler.test.ts` | Cron scheduling |
| `run-queue.test.ts` | Bounded concurrency |
| `graph-client.test.ts` | Graph transport, pagination, CSV parsing |
| `graph-auth.test.ts` | Token acquisition |
| `graph-consent.test.ts` | OAuth consent flow |
| `permissions-grant.test.ts` | Permission declaration/grant |
| `permissions-grant-flow.test.ts` | End-to-end grant flow |
| `connection-test.test.ts` | Vault test connection |
| `connection-test-flow.test.ts` | Full connection test flow |
| `dispatch-email.test.ts` | Email sending |
| `webhooks.test.ts` | Webhook dispatch |
| `alerts.test.ts` | Failure alerts |
| `report-engine.test.ts` | Template rendering, conditions |
| `catalog.test.ts` | Original report definitions |
| `catalog-new.test.ts` | Tier-1 JSON reports |
| `catalog-csv.test.ts` | CSV report parsing |
| `catalog-csv-summaries.test.ts` | CSV report summarization |
| `catalog-extra.test.ts` | Additional reports |
| `catalog-tier3.test.ts` | Tier-3 reports |
| `templates.test.ts` | Template CRUD, versioning |
| `api-routes.test.ts` | API endpoint integration |
| `api.test.ts` | API helpers |
| `backup.test.ts` | Export/import |
| `export.test.ts` | Export format |
| `retry.test.ts` | Retry logic |
| `contrast.test.ts` | Color contrast (accessibility) |
| `job-filter.test.ts` | Job filtering |
| `snooze.test.ts` | Job snooze/unsnooze |
| `compare.test.ts` | Execution comparison |
| `admin-authorize.test.ts` | Admin authorization |

### Running Tests

```bash
bun test tests/           # Run all unit/integration tests
bun test tests/vault.test.ts  # Run single file
bun test --grep "encrypt"     # Run tests matching pattern
```

### Test Environment

- **Database:** In-memory SQLite (`:memory:`)
- **Master key:** `0000000000000000000000000000000000000000000000000000000000000000` (64 hex)
- **No network:** All external calls mocked via dependency injection

### Dependency Injection Pattern

Services accept optional deps for testing:

```typescript
// Production
const execution = await runJob(job);

// Test
const execution = await runJob(job, {
  transport: fakeTransport,
  email: fakeEmail,
  now: () => new Date("2026-01-01"),
});
```

### Mocking

- `fakeTransport` — Returns predetermined Graph responses
- `fakeEmail` — Captures sent messages
- `fakeWebhook` — Captures webhook payloads

---

## E2E Tests

### Location

`e2e/` — Playwright browser tests.

### Setup

```bash
bun run e2e  # Starts server + runs Playwright
```

### Configuration

`playwright.config.ts`:
- Base URL: `http://localhost:8100`
- Browser: Chromium
- Retries: 1
- Workers: 1

### Test Structure

```typescript
import { test, expect } from "@playwright/test";

test("dashboard loads", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.locator("h1")).toHaveText("Dashboard");
});
```

### Coverage

E2E tests cover critical user flows:
- Dashboard navigation
- Catalog browsing
- Job creation
- Settings configuration
- Theme toggle

---

## Green Gate

Every commit must pass:

```bash
bunx tsc --noEmit      # Type check
bun test tests/        # Unit/integration tests
bun run build          # Production build
```

### CI Workflow

```yaml
# .github/workflows/ci.yml
on: [push, pull_request]
jobs:
  test:
    steps:
      - bun install
      - bunx tsc --noEmit
      - bun test tests/
      - bun run build
```

---

## Coverage Target

**80% minimum** across:
- Services (executor, scheduler, vault, graph, dispatch)
- DAOs (jobs, executions, templates, settings)
- Report definitions (all catalog reports)
- API routes (all endpoints)

### Measuring Coverage

```bash
bun test --coverage
```

---

## Testing Patterns

### Unit Test Structure

```typescript
import { describe, it, expect, beforeEach } from "bun:test";

describe("vaultService", () => {
  beforeEach(() => {
    // Reset DB, set master key
  });

  it("encrypts and decrypts", () => {
    vaultService.set("tenantId", "test-value");
    expect(vaultService.get("tenantId")).toBe("test-value");
  });
});
```

### Integration Test Structure

```typescript
describe("executor", () => {
  it("runs a job end-to-end", async () => {
    const job = jobsDao.create({ ... });
    const execution = await runJob(job, {
      transport: fakeTransport,
      email: fakeEmail,
    });
    expect(execution.status).toBe("success");
    expect(execution.emailSent).toBe(true);
  });
});
```

### API Route Testing

```typescript
describe("GET /api/jobs", () => {
  it("returns jobs list", async () => {
    const res = await fetch("http://localhost:8100/api/jobs");
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data).toBeArray();
  });
});
```

---

## Accessibility Testing

`contrast.test.ts` verifies color contrast ratios meet WCAG AA:
- Background/foreground combinations
- Status pill colors
- Accent color on backgrounds

---

## Performance Testing

No formal benchmarks, but:
- NFR-1: Dashboard < 2s load (verified manually)
- NFR-2: Report gen < 5s for <10k records (unit test with synthetic data)
- Graph pagination capped at 50 pages (prevents runaway)

---

## Conventions

- **One test file per module** — Clear ownership
- **Descriptive test names** — "encrypts and decrypts" not "test 1"
- **Before each cleanup** — Fresh DB state per test
- **No network in unit tests** — All external calls mocked
- **Green gate before commit** — Never commit broken tests
- **80% coverage minimum** — Measured, not guessed

---

**References:**
- [Services Layer](./SERVICES.md) — Dependency injection seams
- [Database Layer](./DATABASE.md) — Test DB setup
- [Architecture](./ARCHITECTURE.md) — System overview
