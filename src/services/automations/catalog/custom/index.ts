import type { AutomationDefinition } from "../../types";

/**
 * Automations added with `bun run plugin:new <id> --kind=automation`. The
 * scaffold adds an import + an entry here; the registry includes this list, and
 * `bun run plugin:validate` / tests/automation-contract.test.ts check each one.
 */
// plugin:new imports (do not remove this marker)

export const CUSTOM_AUTOMATIONS: readonly AutomationDefinition[] = [
  // plugin:new entries (do not remove this marker)
];
