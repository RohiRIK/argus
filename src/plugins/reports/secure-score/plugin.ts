import { defineReportPlugin } from "@/plugins/sdk";
import type { ReportSummary } from "@/services/reports/types";

interface SecureScoreRecord {
  id: string;
  currentScore?: number;
  maxScore?: number;
  createdDateTime?: string;
  activeUserCount?: number;
  licensedUserCount?: number;
  enabledServices?: string[];
  averageComparativeScores?: { basis: string; averageScore: number }[];
  controlScores?: SecureScoreControl[];
}

interface SecureScoreControl {
  controlCategory: string;
  controlName: string;
  description?: string;
  score: number;
  implementationStatus?: string;
  scoreInPercentage?: number;
}

function stripHtml(value?: string): string {
  const decoded = (value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&ldquo;/g, "\"")
    .replace(/&rdquo;/g, "\"")
    .replace(/&lsquo;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
  return decoded.replace(/\s+/g, " ").trim();
}

function scorePct(score: number, max: number): number {
  return max ? Math.round((score / max) * 100) : 0;
}

function categoryScore(latest: SecureScoreRecord | undefined, category: string): number {
  return latest?.controlScores?.filter((c) => c.controlCategory === category).reduce((sum, c) => sum + c.score, 0) ?? 0;
}

function controlRecommendation(control: SecureScoreControl): string {
  const pct = control.scoreInPercentage ?? 0;
  if (control.score === 0) return "Not implemented — implement this control to raise Secure Score.";
  if (pct < 50) return "Partially implemented — finish remaining implementation steps.";
  return "Implemented — keep configuration in place.";
}

function controlStatus(control: SecureScoreControl): string {
  return stripHtml(control.implementationStatus) || "—";
}

export const plugin = defineReportPlugin<SecureScoreRecord>({
  id: "secure-score",
  version: "1.0.0",
  name: "Secure Score Trend",
  category: "security",
  description: "Tenant Secure Score with per-control breakdown and peer benchmarks.",
  requiredPermissions: ["SecurityEvents.Read.All"],
  baselineSupport: true,
  tags: ["posture", "secure-score", "benchmarks"],
  recommendedSchedule: "weekly",
  recommendedGroup: "Argus - Security Alerts",
  rowKey: (row) => String(row.control),
  async fetch(transport) {
    return (await transport.get<SecureScoreRecord>("/security/secureScores?$top=7")).value;
  },
  summarize(rows): ReportSummary {
    const latest = rows[0];
    const previous = rows[1];
    const current = latest?.currentScore ?? 0;
    const max = latest?.maxScore ?? 0;
    const previousScore = previous?.currentScore ?? 0;
    const delta = current - previousScore;
    const controls = [...(latest?.controlScores ?? [])].sort((a, b) => a.score - b.score || a.controlName.localeCompare(b.controlName));
    return {
      count: Math.round(current),
      variables: {
        currentScore: Math.round(current),
        maxScore: Math.round(max),
        pctOfMax: scorePct(current, max),
        previousScore: Math.round(previousScore),
        scoreDelta: Math.round(delta),
        scoreTrend: delta === 0 ? "flat" : delta > 0 ? "up" : "down",
        peerAvg: Math.round(latest?.averageComparativeScores?.find((a) => a.basis === "AllTenants")?.averageScore ?? 0),
        identityControls: Math.round(categoryScore(latest, "Identity")),
        dataControls: Math.round(categoryScore(latest, "Data")),
        deviceControls: Math.round(categoryScore(latest, "Device")),
        appsControls: Math.round(categoryScore(latest, "Apps")),
        infrastructureControls: Math.round(categoryScore(latest, "Infrastructure")),
        activeUsers: latest?.activeUserCount ?? 0,
        licensedUsers: latest?.licensedUserCount ?? 0,
        enabledServices: (latest?.enabledServices ?? []).join(", ") || "—",
        snapshotDate: latest?.createdDateTime ? latest.createdDateTime.slice(0, 10) : "—",
      },
      rows: controls.slice(0, 50).map((c) => ({
        category: c.controlCategory,
        control: c.controlName,
        score: c.score,
        pct: c.scoreInPercentage ?? 0,
        status: controlStatus(c),
        recommendation: controlRecommendation(c),
      })),
    };
  },
});
