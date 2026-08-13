import type {
  StartWorkflowRequest,
  WorkflowBackendInfo,
} from "@zuu/client";
import { notFound } from "../../http";
import type { WorkflowBackend } from "./types";
import { FAKE_WORKFLOWS } from "./fake-definitions";
import { createFakeWorkflowRun } from "./fake-run";
import { WorkflowRunStore } from "./run-store";

export class FakeWorkflowBackend implements WorkflowBackend {
  private readonly store: WorkflowRunStore;

  constructor(
    path: string,
    private readonly info: WorkflowBackendInfo,
  ) {
    this.store = new WorkflowRunStore(path);
  }

  getInfo() {
    return this.info;
  }

  async listDefinitions() {
    return FAKE_WORKFLOWS;
  }

  async start(workflowId: string, request: StartWorkflowRequest = {}) {
    const definition = FAKE_WORKFLOWS.find((workflow) => workflow.id === workflowId);
    if (!definition) notFound(`Unknown workflow: ${workflowId}`, { workflowId });

    const run = createFakeWorkflowRun(definition, request);
    this.store.set(run);
    return run;
  }

  async listRuns() {
    return this.store.list();
  }

  async getRun(runId: string) {
    return this.store.get(runId);
  }

  async abort(runId: string) {
    const run = await this.getRun(runId);
    if (run.status === "queued" || run.status === "running") {
      const now = new Date().toISOString();
      run.status = "aborted";
      run.finishedAt = now;
      for (const stageItem of run.stages) {
        if (stageItem.status === "queued" || stageItem.status === "running") {
          stageItem.status = "aborted";
          stageItem.finishedAt = now;
        }
      }
      for (const taskItem of run.tasks) {
        if (taskItem.status === "queued" || taskItem.status === "running") {
          taskItem.status = "aborted";
          taskItem.finishedAt = now;
        }
      }
      this.store.persist();
    }
    return run;
  }
}
