import type {
  StartWorkflowRequest,
  WorkflowBackendInfo,
  WorkflowRun,
  WorkflowRunStatus,
} from "@zuu/client";
import { notFound } from "../../../server";
import type { WorkflowBackend } from "./types";
import {
  NATIVE_WORKFLOWS,
  toPublicWorkflowDefinition,
  type NativeWorkflowDefinition,
  type NativeWorkflowStep,
} from "./native-definitions";
import {
  createNativeWorkflowRun,
  createTaskArtifact,
  getTaskDependencyArtifacts,
  runPromptTask,
  type PromptEventRunner,
} from "./native-run";
import { validateNativeWorkflowDefinition } from "./native-validation";
import { WorkflowRunStore } from "./run-store";
import { abortWorkflowRunRecord } from "./workflow-run-abort";

interface NativeWorkflowBackendOptions {
  path: string;
  info: WorkflowBackendInfo;
  runPrompt: PromptEventRunner;
  maxConcurrency?: number;
}

export class NativeWorkflowBackend implements WorkflowBackend {
  private readonly store: WorkflowRunStore;
  private readonly abortedRunIds = new Set<string>();

  constructor(private readonly options: NativeWorkflowBackendOptions) {
    this.store = new WorkflowRunStore(options.path);
  }

  getInfo() {
    return this.options.info;
  }

  async listDefinitions() {
    return NATIVE_WORKFLOWS.map(toPublicWorkflowDefinition);
  }

  async start(workflowId: string, request: StartWorkflowRequest = {}) {
    const definition = NATIVE_WORKFLOWS.find((workflow) => workflow.id === workflowId);
    if (!definition) notFound(`Unknown workflow: ${workflowId}`, { workflowId });
    validateNativeWorkflowDefinition(definition);

    const run = createNativeWorkflowRun(definition, request);
    this.store.set(run);

    void this.execute(definition, run, request);
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
    this.abortedRunIds.add(runId);
    if (abortWorkflowRunRecord(run)) {
      this.store.persist();
    }
    return run;
  }

  private async execute(definition: NativeWorkflowDefinition, run: WorkflowRun, request: StartWorkflowRequest) {
    const tasksByStepId = new Map(definition.steps.map((step) => [step.id, run.tasks.find((task) => task.id.endsWith(`:${step.id}`))!]));
    const stagesByStepId = new Map(definition.steps.map((step) => [step.id, run.stages.find((stage) => stage.id.endsWith(`:${step.id}`))!]));
    const completed = new Set<string>();
    const failed = new Set<string>();
    const running = new Set<string>();
    const artifactsByStepId = new Map<string, NonNullable<WorkflowRun["artifacts"][number]>>();

    try {
      while (completed.size + failed.size < definition.steps.length) {
        if (this.abortedRunIds.has(run.id)) {
          this.finishRun(run, "aborted");
          return;
        }

        const ready = definition.steps.filter((step) => {
          if (completed.has(step.id) || failed.has(step.id) || running.has(step.id)) return false;
          return (step.dependsOn ?? []).every((dependency) => completed.has(dependency));
        });

        if (ready.length === 0) {
          throw new Error("Native workflow DAG stalled before all tasks completed");
        }

        const batch = ready.slice(0, this.options.maxConcurrency ?? 2);
        await Promise.all(batch.map((step) => this.executeStep(definition, run, request, step, {
          running,
          completed,
          failed,
          artifactsByStepId,
          tasksByStepId,
          stagesByStepId,
        })));

        if (failed.size > 0) {
          markBlockedTasks(definition.steps, failed, tasksByStepId, stagesByStepId);
          this.finishRun(run, "failed");
          return;
        }
      }

      this.finishRun(run, "completed");
    } catch (error) {
      run.error = error instanceof Error ? error.message : String(error);
      this.finishRun(run, this.abortedRunIds.has(run.id) ? "aborted" : "failed");
    } finally {
      this.abortedRunIds.delete(run.id);
      this.store.set(run);
    }
  }

  private async executeStep(
    definition: NativeWorkflowDefinition,
    run: WorkflowRun,
    request: StartWorkflowRequest,
    step: NativeWorkflowStep,
    state: {
      running: Set<string>;
      completed: Set<string>;
      failed: Set<string>;
      artifactsByStepId: Map<string, NonNullable<WorkflowRun["artifacts"][number]>>;
      tasksByStepId: Map<string, WorkflowRun["tasks"][number]>;
      stagesByStepId: Map<string, WorkflowRun["stages"][number]>;
    },
  ) {
    const task = state.tasksByStepId.get(step.id)!;
    const stage = state.stagesByStepId.get(step.id)!;
    const startedAt = new Date().toISOString();

    state.running.add(step.id);
    task.status = "running";
    task.startedAt = startedAt;
    task.attempts = (task.attempts ?? 0) + 1;
    stage.status = "running";
    stage.startedAt = startedAt;
    this.store.set(run);

    try {
      const result = await runPromptTask(
        this.options.runPrompt,
        definition,
        step,
        request,
        getTaskDependencyArtifacts(step, state.artifactsByStepId),
      );
      const finishedAt = new Date().toISOString();
      const status = this.abortedRunIds.has(run.id) ? "aborted" : normalizeTaskStatus(result.agentRun.status);
      const artifact = createTaskArtifact(run.id, task, step, result, finishedAt);

      task.status = status;
      task.finishedAt = finishedAt;
      task.agentRunId = result.agentRun.id;
      task.sessionId = result.agentRun.sessionId;
      task.output = {
        agentRunId: result.agentRun.id,
        sessionId: result.agentRun.sessionId,
        agentStatus: result.agentRun.status,
        error: result.agentRun.error,
      };
      task.artifactIds = [artifact.id];
      stage.status = status;
      stage.finishedAt = finishedAt;
      stage.summary = status === "completed" ? `Completed with agent run ${result.agentRun.id}.` : result.agentRun.error;
      run.artifacts.push(artifact);
      state.artifactsByStepId.set(step.id, artifact);

      if (status === "completed") {
        state.completed.add(step.id);
      } else if (status === "aborted") {
        run.error = "Native workflow run was aborted.";
      } else {
        state.failed.add(step.id);
        run.error = result.agentRun.error ?? `Native workflow task ended with status ${result.agentRun.status}`;
      }
    } catch (error) {
      const finishedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      task.status = "failed";
      task.finishedAt = finishedAt;
      task.output = { error: message };
      stage.status = "failed";
      stage.finishedAt = finishedAt;
      stage.summary = message;
      run.error = message;
      state.failed.add(step.id);
    } finally {
      state.running.delete(step.id);
      run.linkedRunIds = run.tasks.flatMap((item) => item.agentRunId ? [item.agentRunId] : []);
      this.store.set(run);
    }
  }

  private finishRun(run: WorkflowRun, status: WorkflowRunStatus) {
    const finishedAt = new Date().toISOString();
    run.status = status;
    run.finishedAt = finishedAt;

    for (const stage of run.stages) {
      if (stage.status === "queued" || stage.status === "running") {
        stage.status = status === "completed" ? "completed" : status;
        stage.finishedAt = finishedAt;
      }
    }
    for (const task of run.tasks) {
      if (task.status === "queued" || task.status === "running") {
        task.status = status === "completed" ? "completed" : status;
        task.finishedAt = finishedAt;
      }
    }
  }
}

function normalizeTaskStatus(status: string): WorkflowRunStatus {
  if (status === "completed" || status === "aborted") return status;
  return "failed";
}

function markBlockedTasks(
  steps: NativeWorkflowStep[],
  failed: Set<string>,
  tasksByStepId: Map<string, WorkflowRun["tasks"][number]>,
  stagesByStepId: Map<string, WorkflowRun["stages"][number]>,
) {
  const finishedAt = new Date().toISOString();
  for (const step of steps) {
    if (!(step.dependsOn ?? []).some((dependency) => failed.has(dependency))) continue;
    const task = tasksByStepId.get(step.id);
    const stage = stagesByStepId.get(step.id);
    if (task?.status === "queued") {
      task.status = "failed";
      task.finishedAt = finishedAt;
      task.output = { reason: "dependency_failed" };
      failed.add(step.id);
    }
    if (stage?.status === "queued") {
      stage.status = "failed";
      stage.finishedAt = finishedAt;
      stage.summary = "Skipped because an upstream dependency failed.";
    }
  }
}
