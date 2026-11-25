import { plugin as teamsUserActivityReport } from "@/plugins/reports/teams-user-activity/plugin";
import { plugin as mailboxQuotaReport } from "@/plugins/reports/mailbox-quota/plugin";
import { plugin as m365GroupsActivityReport } from "@/plugins/reports/m365-groups-activity/plugin";
import { plugin as onedriveUsageReport } from "@/plugins/reports/onedrive-usage/plugin";
import { plugin as sharepointSiteUsageReport } from "@/plugins/reports/sharepoint-site-usage/plugin";
import { plugin as activeUsersCountsReport } from "@/plugins/reports/active-users-counts/plugin";

export {
  teamsUserActivityReport,
  mailboxQuotaReport,
  m365GroupsActivityReport,
  onedriveUsageReport,
  sharepointSiteUsageReport,
  activeUsersCountsReport,
};

export const csvReports = [
  teamsUserActivityReport,
  mailboxQuotaReport,
  m365GroupsActivityReport,
  onedriveUsageReport,
  sharepointSiteUsageReport,
  activeUsersCountsReport,
];
