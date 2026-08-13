import type { ResourceDiagnostic, StoreDiagnostic, WorkflowBackendInfo } from "@zuu/client";

export interface DiagnosticGapInput {
  agentDir: string;
  availableModelCount: number;
  packages: string[];
  blockedPackages: string[];
  stores: StoreDiagnostic[];
  workflowBackend: WorkflowBackendInfo;
  resourceDiagnostics: ResourceDiagnostic[];
}

export function collectDiagnosticGaps(input: DiagnosticGapInput) {
  const gaps: string[] = [];
  if (input.stores.some((store) => store.recovered)) {
    gaps.push("One or more JSON stores were recovered from corrupt data; inspect resource store diagnostics and backups.");
  }
  if (input.stores.some((store) => !store.ok)) {
    gaps.push("One or more JSON stores are not healthy; inspect store diagnostics before relying on persisted state.");
  }
  if (input.blockedPackages.length > 0) {
    gaps.push(`${input.blockedPackages.length} package source(s) are configured but blocked until trusted.`);
  }
  if (input.workflowBackend.kind === "fake") {
    gaps.push("Workflow backend is fake; set ZUU_WORKFLOW_BACKEND=native to run Zuu native workflow/subagent tasks.");
  }
  if (input.workflowBackend.kind === "pi-package" && input.workflowBackend.status !== "ready") {
    gaps.push(input.workflowBackend.message ?? "Pi workflow backend is not ready.");
  }
  if (!input.packages.some((item) => item.includes("pi-crew"))) {
    gaps.push("Scheduler MVP supports local once/interval/basic cron with IANA timezones and a best-effort local lease; a production HA scheduler backend is still needed for distributed execution.");
  }
  if (input.availableModelCount === 0) {
    gaps.push(`No authenticated model is available; configure provider auth in ${input.agentDir}/auth.json or environment variables.`);
  }
  if (input.resourceDiagnostics.some((diagnostic) => diagnostic.type === "collision")) {
    gaps.push("One or more package resources have name collisions; inspect resource diagnostics before relying on the loaded tools or skills.");
  }
  return gaps;
}
