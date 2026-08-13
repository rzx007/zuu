import type {
  PromptRequest,
  RunSummary,
  StartWorkflowRequest,
  WorkflowBackendInfo,
} from "@zuu/client";
import { notFound } from "../../http";
import type { WorkflowBackend } from "./types";
import { PI_WORKFLOW_DEFINITIONS } from "./pi-package-info";
import { createPiWorkflowLaunch, createPiWorkflowLaunchArtifact } from "./pi-package-launch";
import { WorkflowRunStore } from "./run-store";

interface PiPackageWorkflowBackendOptions {
  path: string;
  info: WorkflowBackendInfo;
  launchPrompt: (request: PromptRequest) => Promise<RunSummary>;
}

export class PiPackageWorkflowBackend implements WorkflowBackend {
  private readonly store: WorkflowRunStore;

  constructor(private readonly options: PiPackageWorkflowBackendOptions) {
    this.store = new WorkflowRunStore(options.path);
  }

  getInfo() {
    return this.options.info;
  }

  async listDefinitions() {
    return PI_WORKFLOW_DEFINITIONS;
  }

  async start(workflowId: string, request: StartWorkflowRequest = {}) {
    const definition = PI_WORKFLOW_DEFINITIONS.find((workflow) => workflow.id === workflowId);
    if (!definition) notFound(`Unknown workflow: ${workflowId}`, { workflowId });

    const now = new Date().toISOString();
    const runId = crypto.randomUUID();
    const { command, run, launchStage, launchTask } = createPiWorkflowLaunch(runId, definition, request, now);
    this.store.set(run);

    try {
      const agentRun = await this.options.launchPrompt({
        prompt: command,
        projectId: request.projectId,
        sessionId: request.sessionId,
        source: "workflow",
        name: `Workflow: ${definition.name}`,
      });
      const finishedAt = new Date().toISOString();
      const artifact = createPiWorkflowLaunchArtifact(runId, launchTask.id, definition, command, agentRun, finishedAt);

      run.status = agentRun.status === "completed" ? "completed" : agentRun.status === "aborted" ? "aborted" : "failed";
      run.finishedAt = finishedAt;
      run.artifacts = [artifact];
      launchStage.status = run.status;
      launchStage.finishedAt = finishedAt;
      launchStage.summary =
        run.status === "completed"
          ? "pi-workflow launch command completed. Detailed board state remains owned by the Pi workflow extension."
          : `pi-workflow launch command ended with agent status ${agentRun.status}.`;
      launchTask.status = run.status;
      launchTask.finishedAt = finishedAt;
      launchTask.output = {
        agentRunId: agentRun.id,
        agentStatus: agentRun.status,
      };
      launchTask.artifactIds = [artifact.id];
      if (run.status === "failed") {
        run.error = `pi-workflow launch command ended with agent status ${agentRun.status}`;
      }
    } catch (error) {
      const finishedAt = new Date().toISOString();
      run.status = "failed";
      run.finishedAt = finishedAt;
      run.error = error instanceof Error ? error.message : String(error);
      launchStage.status = "failed";
      launchStage.finishedAt = finishedAt;
      launchStage.summary = run.error;
      launchTask.status = "failed";
      launchTask.finishedAt = finishedAt;
      launchTask.output = { error: run.error };
    }

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
    const run = this.store.get(runId);
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
