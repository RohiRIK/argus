import { plugin as riskDetectionsReport } from "@/plugins/reports/risk-detections/plugin";
import { plugin as spRiskDetectionsReport } from "@/plugins/reports/sp-risk-detections/plugin";
import { plugin as customAttrAuditsReport } from "@/plugins/reports/custom-attr-audits/plugin";
import { plugin as spSignInsReport } from "@/plugins/reports/sp-sign-ins/plugin";

export {
  riskDetectionsReport,
  spRiskDetectionsReport,
  customAttrAuditsReport,
  spSignInsReport,
};

export const tier3Reports = [
  riskDetectionsReport,
  spRiskDetectionsReport,
  customAttrAuditsReport,
  spSignInsReport,
];
