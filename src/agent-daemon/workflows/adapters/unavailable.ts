import type { WorkflowRun, WorkflowBackendInfo } from "@zuu/client";
import { ApiError, notFound } from "../../../server";
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
    throw new ApiError(this.info.message ?? "Workflow backend is unavailable", {
      status: 503,
      code: "workflow_backend_unavailable",
      details: this.info,
      retryable: false,
    });
  }

  async listRuns() {
    return [];
  }

  async getRun(runId: string): Promise<WorkflowRun> {
    notFound(`Unknown workflow run: ${runId}`, { runId });
  }

  async abort(runId: string): Promise<WorkflowRun> {
    notFound(`Unknown workflow run: ${runId}`, { runId });
  }
}
