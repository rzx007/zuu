import type { WorkflowRun, WorkflowBackendInfo } from "@zuu/client";
import type { WorkflowBackend } from "./types";

export class UnavailableWorkflowBackend implements WorkflowBackend {
  constructor(private readonly info: WorkflowBackendInfo) {}

  getInfo() {
    return this.info;
  }

  async listDefinitions() {
    return [];
  }

  async start(): Promise<WorkflowRun> {
    throw new Error(this.info.message ?? "Workflow backend is unavailable");
  }

  async listRuns() {
    return [];
  }

  async getRun(runId: string): Promise<WorkflowRun> {
    throw new Error(`Unknown workflow run: ${runId}`);
  }

  async abort(runId: string): Promise<WorkflowRun> {
    throw new Error(`Unknown workflow run: ${runId}`);
  }
}
