import { expect, test, describe } from "bun:test";
import type { GraphTransport } from "../src/services/graph/client";
import { riskyUsersReport } from "../src/services/reports/catalog";
import { riskyServicePrincipalsReport } from "../src/services/reports/catalog-new";
import { riskDetectionsReport, spRiskDetectionsReport } from "../src/services/reports/catalog-tier3";

/** Records every path the report asks the transport for. */
function recordingTransport(): { transport: GraphTransport; paths: string[] } {
  const paths: string[] = [];
  return {
    paths,
    transport: {
      get: async (path: string) => {
        paths.push(path);
        return { value: [], latencyMs: 1 };
      },
    },
  };
}

describe("Identity Protection reports cap $top at 500 (not 999 → 400)", () => {
  const cases = [
    { name: "riskyUsers", report: riskyUsersReport, endpoint: "/identityProtection/riskyUsers" },
    { name: "riskyServicePrincipals", report: riskyServicePrincipalsReport, endpoint: "/identityProtection/riskyServicePrincipals" },
    { name: "riskDetections", report: riskDetectionsReport, endpoint: "/identityProtection/riskDetections" },
    { name: "spRiskDetections", report: spRiskDetectionsReport, endpoint: "/identityProtection/servicePrincipalRiskDetections" },
  ];

  for (const c of cases) {
    test(`${c.name} requests $top=500`, async () => {
      const { transport, paths } = recordingTransport();
      await c.report.fetch(transport, {});
      const p = paths.find((x) => x.includes(c.endpoint))!;
      expect(p).toContain("$top=500");
      expect(p).not.toContain("$top=999");
    });
  }
});
