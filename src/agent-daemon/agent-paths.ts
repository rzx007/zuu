import { mkdirSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_AGENT_DIR = join(process.cwd(), ".zuu", "pi-agent");

export function getZuuAgentDir() {
  const agentDir = process.env.ZUU_AGENT_DIR || DEFAULT_AGENT_DIR;
  mkdirSync(agentDir, { recursive: true });
  return agentDir;
}

export function getSessionDir(agentDir: string) {
  const sessionDir = join(agentDir, "sessions");
  mkdirSync(sessionDir, { recursive: true });
  return sessionDir;
}

export function getRunStorePath(agentDir: string) {
  return join(agentDir, "runs.json");
}

export function getRunEventStorePath(agentDir: string) {
  return join(agentDir, "run-events.json");
}

export function getProjectStorePath(agentDir: string) {
  return join(agentDir, "projects.json");
}

export function getApprovalStorePath(agentDir: string) {
  return join(agentDir, "approvals.json");
}

export function getWorkflowStorePath(agentDir: string) {
  return join(agentDir, "workflow-runs.json");
}

export function getScheduleStorePath(agentDir: string) {
  return join(agentDir, "schedules.json");
}

export function getScheduleLeaseStorePath(agentDir: string) {
  return join(agentDir, "scheduler-lease.json");
}

export function getPackageOperationStorePath(agentDir: string) {
  return join(agentDir, "package-operations.json");
}

export function getPackageTrustStorePath(agentDir: string) {
  return join(agentDir, "package-trust.json");
}

export function getAuthTokenStorePath(agentDir: string) {
  return join(agentDir, "auth-token.json");
}

export function getAuditEventStorePath(agentDir: string) {
  return join(agentDir, "audit-events.json");
}
