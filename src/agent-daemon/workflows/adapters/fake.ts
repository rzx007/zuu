import type {
  StartWorkflowRequest,
  WorkflowBackendInfo,
} from "@zuu/client";
import { notFound } from "../../../http";
import type { WorkflowBackend } from "./types";
import { FAKE_WORKFLOWS } from "./fake-definitions";
import { createFakeWorkflowRun } from "./fake-run";
import { WorkflowRunStore } from "./run-store";
import { abortWorkflowRunRecord } from "./workflow-run-abort";

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
    if (abortWorkflowRunRecord(run)) {
      this.store.persist();
    }
    return run;
  }
}
