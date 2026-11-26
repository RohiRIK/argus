import type { AutomationDefinition } from "./types";
import {
  breakGlassCaExclusionAutomation,
  caBaselineAndNamedLocationAutomation,
} from "./catalog/conditional-access";
import {
  staleB2bGuestCleanupAutomation,
  highRiskUserContainmentAutomation,
  externalMailboxForwardingAutomation,
  riskyWorkloadIdentityContainmentAutomation,
  riskyOauthConsentRevocationAutomation,
  tenantAuthPolicyGuardrailAutomation,
} from "./catalog/identity-security";
import {
  disabledUserLicenseGroupReclaimAutomation,
  dormantUserLicenseReclaimAutomation,
  privilegedRoleDriftGuardAutomation,
  expiredAppSecretHygieneAutomation,
  ownerlessM365GroupAutomation,
  staleDeviceHygieneAutomation,
} from "./catalog/licensing-governance-devices";
import { LIFECYCLE_AUTOMATIONS } from "./catalog/lifecycle";
import { CUSTOM_AUTOMATIONS } from "./catalog/custom";

export const BUILTIN_AUTOMATIONS: readonly AutomationDefinition[] = [
  breakGlassCaExclusionAutomation,
  caBaselineAndNamedLocationAutomation,
  highRiskUserContainmentAutomation,
  externalMailboxForwardingAutomation,
  riskyWorkloadIdentityContainmentAutomation,
  riskyOauthConsentRevocationAutomation,
  privilegedRoleDriftGuardAutomation,
  tenantAuthPolicyGuardrailAutomation,
  disabledUserLicenseGroupReclaimAutomation,
  dormantUserLicenseReclaimAutomation,
  staleB2bGuestCleanupAutomation,
  expiredAppSecretHygieneAutomation,
  ownerlessM365GroupAutomation,
  staleDeviceHygieneAutomation,
  ...LIFECYCLE_AUTOMATIONS,
  ...CUSTOM_AUTOMATIONS,
];

export interface AutomationSolutionPack {
  id: string;
  name: string;
  tagline: string;
  automationIds: string[];
}

export const AUTOMATION_SOLUTION_PACKS: readonly AutomationSolutionPack[] = [
  {
    id: "zero-trust-guardrails",
    name: "Zero-Trust & Lockout Guardrails",
    tagline: "Break-glass CA exclusions, mandatory CA baseline drift, Tier-0 roles & CIS tenant hardening.",
    automationIds: [
      "break-glass-ca-exclusion-guardrail",
      "ca-baseline-and-named-location-guardrail",
      "privileged-role-drift-guard",
      "tenant-authorization-policy-guardrail",
    ],
  },
  {
    id: "secops-response",
    name: "Active Threat Containment",
    tagline: "Contain compromised users/service principals, neutralize BEC forwarding & OAuth phishing.",
    automationIds: [
      "high-risk-user-containment",
      "risky-workload-identity-containment",
      "external-mailbox-forwarding-remediation",
      "risky-oauth-consent-revocation",
    ],
  },
  {
    id: "lifecycle-finops",
    name: "Lifecycle Hygiene & FinOps Reclaim",
    tagline: "Reclaim disabled/dormant licenses and clean up stale B2B guests, apps, groups & devices.",
    automationIds: [
      "disabled-user-license-group-reclaim",
      "dormant-user-license-reclaim",
      "stale-b2b-guest-cleanup",
      "expired-app-secret-hygiene",
    ],
  },
  {
    id: "user-device-lifecycle",
    name: "User & Device Lifecycle",
    tagline: "Joiner/mover group sync, leaver offboarding, inactive account disable/cleanup & end-of-support OS.",
    automationIds: [
      "joiner-mover-group-sync",
      "leaver-offboarding",
      "inactive-user-disable",
      "disabled-user-cleanup",
      "unsupported-os-lifecycle",
      "stale-device-hygiene",
    ],
  },
];

const BY_ID = new Map<string, AutomationDefinition>(
  BUILTIN_AUTOMATIONS.map((a) => [a.id, a]),
);

export function listAutomations(): AutomationDefinition[] {
  return [...BUILTIN_AUTOMATIONS];
}

export function getAutomation(id: string): AutomationDefinition | undefined {
  return BY_ID.get(id);
}

export function defaultParamsForAutomation(def: AutomationDefinition): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of def.paramSchema) {
    if (field.defaultValue !== undefined) {
      out[field.key] = structuredClone(field.defaultValue);
    }
  }
  return out;
}
