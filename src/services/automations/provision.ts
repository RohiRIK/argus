import { getAutomation } from "./registry";
import type { AutomationGraphTransport } from "./types";
import { createEntraSecurityGroup, type GroupGraphDeps } from "@/services/graph/groups";
import { getAutomationGraphClient, liveAutomationGraphTransport } from "@/services/graph/automation-client";
import { ValidationError } from "@/lib/errors";

export interface ProvisionDeps {
  transport?: AutomationGraphTransport;
  groupDeps?: GroupGraphDeps;
}

/**
 * One-click provisioning for a catalog param that declares `provision`. The name comes from the
 * catalog definition (never from the request), and an existing group with that exact name is reused
 * so repeated clicks never create duplicates.
 */
export async function provisionAutomationParam(
  automationType: string,
  paramKey: string,
  deps: ProvisionDeps = {},
): Promise<{ id: string; displayName: string; created: boolean }> {
  const field = getAutomation(automationType)?.paramSchema.find((f) => f.key === paramKey);
  if (!field?.provision) throw new ValidationError(`Nothing to provision for ${automationType}.${paramKey}`);

  const { displayName, description } = field.provision;
  const transport = deps.transport ?? liveAutomationGraphTransport;
  const escaped = displayName.replace(/'/g, "''");
  const existing = await transport.get<{ id: string; displayName?: string; groupTypes?: string[]; securityEnabled?: boolean }>(
    `/groups?$filter=displayName eq '${escaped}'&$select=id,displayName,groupTypes,securityEnabled`,
  );
  const reusable = existing.value.find((g) => g.securityEnabled && !(g.groupTypes ?? []).includes("DynamicMembership"));
  if (reusable) return { id: reusable.id, displayName: reusable.displayName ?? displayName, created: false };

  const groupDeps = deps.groupDeps ?? { client: getAutomationGraphClient() as unknown as GroupGraphDeps["client"] };
  const group = await createEntraSecurityGroup({ displayName, description }, groupDeps);
  return { id: group.id, displayName: group.displayName, created: true };
}
