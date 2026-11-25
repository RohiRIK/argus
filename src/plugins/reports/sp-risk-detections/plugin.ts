import { defineReportPlugin } from "@/plugins/sdk";
import type { ReportSummary } from "@/services/reports/types";

const WEEK_MS = 604_800_000;
const terminalRiskStates = new Set(["remediated", "dismissed", "confirmedSafe"]);

interface SpRiskDetection {
  id: string;
  riskEventType?: string;
  riskLevel?: "low" | "medium" | "high" | "none" | "hidden";
  riskState?: string;
  riskDetail?: string;
  servicePrincipalDisplayName?: string;
  servicePrincipalId?: string;
  appId?: string;
  detectedDateTime?: string;
  lastUpdatedDateTime?: string;
  ipAddress?: string;
  activity?: string;
  additionalInfo?: string;
  keyIds?: string[];
  currentRiskLevel?: "low" | "medium" | "high" | "none" | "hidden";
  currentRiskState?: string;
  currentRiskLastUpdatedDateTime?: string;
}

interface RiskyServicePrincipalState {
  id?: string;
  displayName?: string;
  appId?: string;
  servicePrincipalType?: string;
  riskLevel?: "low" | "medium" | "high" | "none" | "hidden";
  riskState?: string;
  riskDetail?: string;
  riskLastUpdatedDateTime?: string;
  isEnabled?: boolean;
  isProcessing?: boolean;
}

function isSpRiskActive(row: SpRiskDetection): boolean {
  return row.currentRiskState === "atRisk" || row.currentRiskState === "confirmedCompromised" || row.riskState === "atRisk" || row.riskState === "confirmedCompromised";
}

function isSpRemediatedThisWeek(row: SpRiskDetection): boolean {
  const state = row.currentRiskState ?? row.riskState;
  if (!terminalRiskStates.has(state ?? "")) return false;
  const updated = row.lastUpdatedDateTime ?? row.currentRiskLastUpdatedDateTime ?? row.detectedDateTime;
  if (!updated) return true;
  return new Date(updated).getTime() >= Date.now() - WEEK_MS;
}

function isRecent(value?: string): boolean {
  if (!value) return true;
  return new Date(value).getTime() >= Date.now() - WEEK_MS;
}

function spRiskReason(row: SpRiskDetection): string {
  const parts: string[] = [];
  if (row.riskEventType && row.riskEventType !== "current-risky-service-principal") parts.push(row.riskEventType);
  if (row.riskDetail && row.riskDetail !== "none") parts.push(row.riskDetail);
  if (!parts.length && row.currentRiskState) parts.push(row.currentRiskState);
  return parts.join(" · ") || "unknown";
}

function spRemediationText(row: SpRiskDetection): string {
  const state = row.currentRiskState ?? row.riskState ?? "";
  if (isSpRiskActive(row)) return "Pending: review credential/key exposure, rotate secrets if needed, then dismiss if false positive.";
  if (state === "remediated") return `Complete: ${row.riskDetail || "remediated"}`;
  if (state === "dismissed") return `Dismissed: ${row.riskDetail || "dismissed"}`;
  if (state === "confirmedSafe") return `Confirmed safe: ${row.riskDetail || "confirmed safe"}`;
  return "No current remediation state.";
}

function shortDate(value?: string): string {
  return value ? value.slice(0, 10) : "—";
}

function shortDateTime(value?: string): string {
  if (!value) return "—";
  return value.replace("T", " ").replace(/\.\d{3}Z$/, "Z");
}

export const plugin = defineReportPlugin<SpRiskDetection>({
  id: "sp-risk-detections",
  version: "1.0.0",
  name: "Service Principal Risk Detections",
  category: "security",
  service: "Microsoft Defender",
  icon: "credentials",
  dataSource: "graph-v1",
  metrics: ["App risk events","Detection timing","Risk state"],
  description: "Current and last-week risk detections for workload identities (apps, managed identities).",
  requiredPermissions: ["IdentityRiskyServicePrincipal.Read.All"],
  baselineSupport: true,
  tags: ["workload-identity", "risk-events", "apps"],
  recommendedSchedule: "daily",
  recommendedGroup: "Argus - Security Alerts",
  rowKey: (row) => `${row.servicePrincipalId}|${row.appId}|${row.detected}`,
  async fetch(transport) {
    const since = new Date(Date.now() - WEEK_MS).toISOString();
    const [detections, current] = await Promise.all([
      (
        await transport.get<SpRiskDetection>(
          "/identityProtection/servicePrincipalRiskDetections?$top=500&$filter=detectedDateTime ge " +
            `${since}&$select=id,riskEventType,riskLevel,riskState,riskDetail,servicePrincipalDisplayName,servicePrincipalId,appId,detectedDateTime,lastUpdatedDateTime,ipAddress,activity,additionalInfo,keyIds`,
        )
      ).value,
      (
        await transport.get<RiskyServicePrincipalState>(
          "/identityProtection/riskyServicePrincipals?$top=500&$select=id,displayName,appId,servicePrincipalType,riskLevel,riskState,riskDetail,riskLastUpdatedDateTime,isEnabled,isProcessing",
        )
      ).value,
    ]);
    const currentBySpId = new Map(current.map((s) => [(s.id ?? "").toLowerCase(), s]));
    const currentByAppId = new Map(current.map((s) => [(s.appId ?? "").toLowerCase(), s]));
    const seen = new Set<string>();
    const enriched = detections.map((d) => {
      const key = (d.servicePrincipalId ?? "").toLowerCase();
      const appIdKey = (d.appId ?? "").toLowerCase();
      if (key) seen.add(key);
      if (appIdKey) seen.add(appIdKey);
      const sp = currentBySpId.get(key) ?? (appIdKey ? currentByAppId.get(appIdKey) : undefined);
      return {
        ...d,
        currentRiskLevel: sp?.riskLevel ?? "none",
        currentRiskState: sp?.riskState ?? "notInRiskyServicePrincipals",
        currentRiskLastUpdatedDateTime: sp?.riskLastUpdatedDateTime,
      };
    });
    const activeWithoutDetection = current
      .filter((s) => s.riskState === "atRisk" || s.riskState === "confirmedCompromised")
      .filter((s) => isRecent(s.riskLastUpdatedDateTime))
      .filter((s) => !seen.has((s.id ?? "").toLowerCase()) && !seen.has((s.appId ?? "").toLowerCase()))
      .map((s) => ({
        id: `current-${s.id ?? s.appId ?? crypto.randomUUID()}`,
        riskEventType: "current-risky-service-principal",
        riskLevel: s.riskLevel ?? "none",
        riskState: s.riskState,
        riskDetail: `Current Identity Protection state: ${s.riskState}`,
        servicePrincipalDisplayName: s.displayName,
        servicePrincipalId: s.id,
        appId: s.appId,
        detectedDateTime: s.riskLastUpdatedDateTime,
        lastUpdatedDateTime: s.riskLastUpdatedDateTime,
        currentRiskLevel: s.riskLevel ?? "none",
        currentRiskState: s.riskState,
        currentRiskLastUpdatedDateTime: s.riskLastUpdatedDateTime,
      }));
    return [...enriched, ...activeWithoutDetection];
  },
  summarize(rows): ReportSummary {
    const relevant = rows.filter((r) => isSpRiskActive(r) || isSpRemediatedThisWeek(r));
    const high = rows.filter((r) => r.riskLevel === "high");
    const activeRisk = rows.filter(isSpRiskActive);
    const remediatedThisWeek = rows.filter(isSpRemediatedThisWeek);
    const byType = relevant.reduce<Record<string, number>>((acc, r) => {
      const k = r.riskEventType ?? "unknown";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    return {
      count: relevant.length,
      variables: {
        totalDetections: rows.length,
        highRisk: high.length,
        activeRisk: activeRisk.length,
        remediatedThisWeek: remediatedThisWeek.length,
        types: Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(", ") || "none",
      },
      rows: relevant.slice(0, 50).map((r) => ({
        servicePrincipal: r.servicePrincipalDisplayName ?? "—",
        appId: r.appId ?? "—",
        level: r.riskLevel ?? "none",
        state: r.currentRiskState ?? r.riskState ?? "—",
        why: spRiskReason(r),
        detected: shortDate(r.detectedDateTime),
        remediatedAt: shortDateTime(r.lastUpdatedDateTime ?? r.currentRiskLastUpdatedDateTime),
        remediation: spRemediationText(r),
        servicePrincipalId: r.servicePrincipalId ?? "—",
        ipAddress: r.ipAddress ?? "—",
      })),
    };
  },
});
