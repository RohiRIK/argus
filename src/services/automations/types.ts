import type { PluginIconKey, RecommendedSchedule } from "@/services/reports/types";
import type { AutomationRollbackSpec } from "@/db/schema";

export type AutomationCategory =
  | "conditional-access"
  | "identity"
  | "security"
  | "licensing"
  | "governance"
  | "devices";

export type AutomationRiskLevel = "low" | "medium" | "high";

export interface AutomationParamField {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "string_list" | "select";
  description: string;
  required?: boolean;
  defaultValue?: unknown;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  /** One-click "Create" in the UI: Argus creates (or reuses by name) this cloud security group and fills its id. */
  provision?: { kind: "securityGroup"; displayName: string; description: string };
}

/**
 * Isolated Read-Write Graph transport backed exclusively by the `microsoft365-automation`
 * Entra App Registration (`auto_*` vault credentials). Never shares tokens with Reporting.
 */
export interface AutomationGraphTransport {
  get<T = unknown>(path: string): Promise<{ value: T[]; latencyMs: number; truncated?: boolean }>;
  getOne<T = unknown>(path: string): Promise<{ data: T; latencyMs: number }>;
  post<T = unknown>(path: string, body?: unknown): Promise<{ data: T; latencyMs: number }>;
  patch<T = unknown>(path: string, body: unknown): Promise<{ data: T; latencyMs: number }>;
  delete(path: string): Promise<{ latencyMs: number }>;
}

export interface PlannedAutomationAction {
  targetType: string;
  targetId: string;
  targetLabel: string;
  actionType: string;
  reason: string;
  beforeState: Record<string, unknown>;
  /** Expected state after remediation (populated during plan for What-If preview, refined during apply). */
  plannedAfterState?: Record<string, unknown>;
  /** Optional declarative Graph mutation payload if `applyAction` wants metadata, or rollback spec. */
  rollbackPayload?: AutomationRollbackSpec | null;
  /** Arbitrary internal metadata passed from `plan()` to `apply()`. */
  meta?: Record<string, unknown>;
}

export interface AutomationPlanResult {
  evaluatedCount: number;
  summary: string;
  actions: PlannedAutomationAction[];
}

export interface AutomationApplyResult {
  afterState: Record<string, unknown>;
  rollbackPayload?: AutomationRollbackSpec | null;
  note?: string;
}

export interface AutomationDefinition {
  apiVersion: "argus.automation/v1";
  id: string;
  version: string;
  name: string;
  category: AutomationCategory;
  riskLevel: AutomationRiskLevel;
  description: string;
  /** Exact Microsoft Graph Application permissions needed (read + write). */
  requiredPermissions: string[];
  recommendedSchedule: RecommendedSchedule;
  recommendedMode: "audit" | "enforce";
  service: string;
  icon: PluginIconKey;
  dataSource: "graph-v1" | "graph-beta";
  tags: string[];
  /** Paired read-only report id in `/catalog`, if applicable. */
  pairedReportId?: string;
  paramSchema: AutomationParamField[];
  /**
   * Read-only discovery phase (`Audit / What-If` AND pre-flight for `Enforce`).
   * MUST NOT mutate tenant state — only calls `transport.get` / `transport.getOne`.
   */
  plan(
    transport: AutomationGraphTransport,
    params: Record<string, unknown>,
  ): Promise<AutomationPlanResult>;
  /**
   * Live remediation phase for a single planned action (only invoked in `enforce` mode
   * when circuit breaker passes). Returns `afterState` + optional `rollbackPayload`.
   */
  apply(
    transport: AutomationGraphTransport,
    action: PlannedAutomationAction,
    params: Record<string, unknown>,
  ): Promise<AutomationApplyResult>;
}
