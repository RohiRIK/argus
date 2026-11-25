import { defineReportPlugin } from "@/plugins/sdk";
import type { ReportSummary } from "@/services/reports/types";

const WEEK_MS = 604_800_000;
const terminalRiskStates = new Set(["remediated", "dismissed", "confirmedSafe"]);

interface RiskDetection {
  id: string;
  riskEventType?: string;
  riskLevel?: "low" | "medium" | "high" | "none";
  riskState?: string;
  riskDetail?: string;
  userPrincipalName?: string;
  userDisplayName?: string;
  detectedDateTime?: string;
  lastUpdatedDateTime?: string;
  ipAddress?: string;
  activity?: string;
  additionalInfo?: string;
  currentRiskLevel?: "low" | "medium" | "high" | "none";
  currentRiskState?: string;
  currentRiskLastUpdatedDateTime?: string;
}

interface RiskyUserState {
  id?: string;
  userPrincipalName?: string;
  riskLevel?: "low" | "medium" | "high" | "none";
  riskState?: string;
  riskLastUpdatedDateTime?: string;
}

function isCurrentRiskActive(row: RiskDetection): boolean {
  return row.currentRiskState === "atRisk" || row.currentRiskState === "confirmedCompromised" || row.riskState === "atRisk" || row.riskState === "confirmedCompromised";
}

function isRemediatedThisWeek(row: RiskDetection): boolean {
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

function riskReason(row: RiskDetection): string {
  const parts: string[] = [];
  if (row.riskEventType && row.riskEventType !== "current-risky-user") parts.push(row.riskEventType);
  if (row.riskDetail && row.riskDetail !== "none") parts.push(row.riskDetail);
  if (!parts.length && row.currentRiskState) parts.push(row.currentRiskState);
  return parts.join(" · ") || "unknown";
}

function remediationText(row: RiskDetection): string {
  const state = row.currentRiskState ?? row.riskState ?? "";
  if (isCurrentRiskActive(row)) return "Pending: verify credential reset, revoke sessions, then dismiss if false positive.";
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

export const plugin = defineReportPlugin<RiskDetection>({
  id: "risk-detections",
  version: "1.0.0",
  name: "User Risk Detections",
  category: "security",
  service: "Microsoft Defender",
  icon: "defender",
  dataSource: "graph-v1",
  metrics: ["Identity risk events","IP & location","Risk level & state"],
  description: "Individual Identity Protection risk detection events (per-event granularity).",
  requiredPermissions: ["IdentityRiskEvent.Read.All", "IdentityRiskyUser.Read.All"],
  baselineSupport: true,
  tags: ["identity-protection", "risk-events", "users"],
  recommendedSchedule: "daily",
  recommendedGroup: "Argus - Security Alerts",
  rowKey: (row) => `${row.user}|${row.type}|${row.detected}`,
  async fetch(transport) {
    const since = new Date(Date.now() - WEEK_MS).toISOString();
    const [detections, users] = await Promise.all([
      (
        await transport.get<RiskDetection>(
          `/identityProtection/riskDetections?$top=500&$filter=detectedDateTime ge ${since}&$select=id,riskEventType,riskLevel,riskState,riskDetail,userPrincipalName,userDisplayName,detectedDateTime,lastUpdatedDateTime,ipAddress,activity,additionalInfo`,
        )
      ).value,
      (
        await transport.get<RiskyUserState>(
          "/identityProtection/riskyUsers?$top=500&$select=id,userPrincipalName,riskLevel,riskState,riskLastUpdatedDateTime",
        )
      ).value,
    ]);
    const currentByUser = new Map(users.map((u) => [(u.userPrincipalName ?? "").toLowerCase(), u]));
    const seenUsers = new Set<string>();
    const enriched = detections.map((d) => {
      const key = (d.userPrincipalName ?? "").toLowerCase();
      seenUsers.add(key);
      const current = currentByUser.get(key);
      return {
        ...d,
        currentRiskLevel: current?.riskLevel ?? "none",
        currentRiskState: current?.riskState ?? "notInRiskyUsers",
        currentRiskLastUpdatedDateTime: current?.riskLastUpdatedDateTime,
      };
    });
    const activeWithoutDetection = users
      .filter((u) => u.riskState === "atRisk" || u.riskState === "confirmedCompromised")
      .filter((u) => isRecent(u.riskLastUpdatedDateTime))
      .filter((u) => !seenUsers.has((u.userPrincipalName ?? "").toLowerCase()))
      .map((u) => ({
        id: `current-${u.id ?? u.userPrincipalName ?? crypto.randomUUID()}`,
        riskEventType: "current-risky-user",
        riskLevel: u.riskLevel ?? "none",
        riskState: u.riskState,
        riskDetail: `Current Identity Protection state: ${u.riskState}`,
        userPrincipalName: u.userPrincipalName,
        detectedDateTime: u.riskLastUpdatedDateTime,
        lastUpdatedDateTime: u.riskLastUpdatedDateTime,
        currentRiskLevel: u.riskLevel ?? "none",
        currentRiskState: u.riskState,
        currentRiskLastUpdatedDateTime: u.riskLastUpdatedDateTime,
      }));
    return [...enriched, ...activeWithoutDetection];
  },
  summarize(rows): ReportSummary {
    const relevant = rows.filter((r) => isCurrentRiskActive(r) || isRemediatedThisWeek(r));
    const high = rows.filter((r) => r.riskLevel === "high");
    const activeRisk = rows.filter(isCurrentRiskActive);
    const remediatedThisWeek = rows.filter(isRemediatedThisWeek);
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
        types: Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(", "),
      },
      rows: relevant.slice(0, 50).map((r) => ({
        user: r.userPrincipalName ?? "—",
        type: r.riskEventType ?? "—",
        level: r.riskLevel ?? "none",
        why: riskReason(r),
        currentState: r.currentRiskState ?? "—",
        detected: shortDate(r.detectedDateTime),
        remediatedAt: shortDateTime(r.lastUpdatedDateTime ?? r.currentRiskLastUpdatedDateTime),
        remediation: remediationText(r),
        ipAddress: r.ipAddress ?? "—",
      })),
    };
  },
});
