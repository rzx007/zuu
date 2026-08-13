import {
  getApprovalStorePath,
  getAuthTokenStorePath,
  getAuditEventStorePath,
  getPackageOperationStorePath,
  getPackageTrustStorePath,
  getProjectStorePath,
  getRunEventStorePath,
  getRunStorePath,
  getScheduleLeaseStorePath,
  getScheduleStorePath,
  getWorkflowStorePath,
} from "./agent-paths";
import { inspectJsonStore } from "./json-file-store";

export function inspectDiagnosticStores(agentDir: string) {
  return [
    inspectJsonStore({
      name: "projects",
      path: getProjectStorePath(agentDir),
      defaultValue: { projects: [] },
      countRecords: (value) =>
        value && typeof value === "object" && "projects" in value && Array.isArray(value.projects)
          ? value.projects.length
          : 0,
    }),
    inspectJsonStore({ name: "runs", path: getRunStorePath(agentDir), defaultValue: [] }),
    inspectJsonStore({ name: "run-events", path: getRunEventStorePath(agentDir), defaultValue: [] }),
    inspectJsonStore({ name: "approvals", path: getApprovalStorePath(agentDir), defaultValue: [] }),
    inspectJsonStore({ name: "workflow-runs", path: getWorkflowStorePath(agentDir), defaultValue: [] }),
    inspectJsonStore({ name: "schedules", path: getScheduleStorePath(agentDir), defaultValue: [] }),
    inspectJsonStore({ name: "scheduler-lease", path: getScheduleLeaseStorePath(agentDir), defaultValue: null }),
    inspectJsonStore({ name: "package-operations", path: getPackageOperationStorePath(agentDir), defaultValue: [] }),
    inspectJsonStore({ name: "package-trust", path: getPackageTrustStorePath(agentDir), defaultValue: [] }),
    inspectJsonStore({ name: "auth-token", path: getAuthTokenStorePath(agentDir), defaultValue: { token: "", createdAt: "" } }),
    inspectJsonStore({ name: "audit-events", path: getAuditEventStorePath(agentDir), defaultValue: [] }),
  ];
}
