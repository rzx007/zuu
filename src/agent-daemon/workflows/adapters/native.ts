import type {
  StartWorkflowRequest,
  ProjectSummary,
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
  createTaskErrorArtifact,
  createTaskArtifact,
  getTaskDependencyArtifacts,
  runPromptTask,
  type PromptEventRunner,
} from "./native-run";
import { loadProjectNativeWorkflowDefinitions } from "./native-project-definitions";
import { validateNativeWorkflowDefinition } from "./native-validation";
import { WorkflowRunStore } from "./run-store";
import { abortWorkflowRunRecord } from "./workflow-run-abort";

interface NativeWorkflowBackendOptions {
  path: string;
  info: WorkflowBackendInfo;
  runPrompt: PromptEventRunner;
  abortAgentRun?: (runId: string, projectId?: string) => Promise<unknown>;
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

  async listDefinitions(project?: ProjectSummary) {
    return this.listNativeDefinitions(project).map(toPublicWorkflowDefinition);
  }

  async start(workflowId: string, request: StartWorkflowRequest = {}, project?: ProjectSummary) {
    const definition = this.listNativeDefinitions(project).find((workflow) => workflow.id === workflowId);
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
    await Promise.all(run.linkedRunIds?.map((agentRunId) => this.abortAgentRun(agentRunId, run.projectId)) ?? []);
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

        if (this.abortedRunIds.has(run.id) || run.tasks.some((task) => task.status === "aborted")) {
          this.finishRun(run, "aborted");
          return;
        }

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
    const maxAttempts = step.retryPolicy?.maxAttempts ?? 1;
    const backoffMs = step.retryPolicy?.backoffMs ?? 0;

    state.running.add(step.id);

    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (this.abortedRunIds.has(run.id)) {
          task.status = "aborted";
          stage.status = "aborted";
          run.error = "Native workflow run was aborted.";
          state.failed.add(step.id);
          return;
        }

        const startedAt = new Date().toISOString();
        task.status = "running";
        task.startedAt ??= startedAt;
        task.attempts = attempt;
        task.input = {
          stepId: step.id,
          dependsOn: step.dependsOn ?? [],
          retryPolicy: step.retryPolicy,
          timeoutMs: step.timeoutMs,
          attempt,
          maxAttempts,
        };
        stage.status = "running";
        stage.startedAt ??= startedAt;
        stage.summary = attempt > 1 ? `Retrying attempt ${attempt} of ${maxAttempts}.` : undefined;
        this.store.set(run);

        try {
          const result = await withOptionalTimeout(
            runPromptTask(
              this.options.runPrompt,
              definition,
              step,
              request,
              getTaskDependencyArtifacts(step, state.artifactsByStepId),
              {
                onRun: (agentRun) => {
                  task.agentRunId = agentRun.id;
                  task.sessionId = agentRun.sessionId;
                  run.linkedRunIds = run.tasks.flatMap((item) => item.agentRunId ? [item.agentRunId] : []);
                  this.store.set(run);
                  if (this.abortedRunIds.has(run.id)) {
                    void this.abortAgentRun(agentRun.id, run.projectId);
                  }
                },
              },
            ),
            step.timeoutMs,
            step.id,
          );
          const finishedAt = new Date().toISOString();
          const status = this.abortedRunIds.has(run.id) ? "aborted" : normalizeTaskStatus(result.agentRun.status);
          const artifact = createTaskArtifact(run.id, task, step, result, finishedAt);

          task.agentRunId = result.agentRun.id;
          task.sessionId = result.agentRun.sessionId;
          task.output = {
            agentRunId: result.agentRun.id,
            sessionId: result.agentRun.sessionId,
            agentStatus: result.agentRun.status,
            error: result.agentRun.error,
            attempt,
            maxAttempts,
          };
          task.artifactIds.push(artifact.id);
          run.artifacts.push(artifact);
          run.linkedRunIds = run.tasks.flatMap((item) => item.agentRunId ? [item.agentRunId] : []);

          if (status === "completed") {
            task.status = "completed";
            task.finishedAt = finishedAt;
            stage.status = "completed";
            stage.finishedAt = finishedAt;
            stage.summary = `Completed with agent run ${result.agentRun.id}.`;
            state.artifactsByStepId.set(step.id, artifact);
            state.completed.add(step.id);
            return;
          }

          if (status === "aborted") {
            task.status = "aborted";
            task.finishedAt = finishedAt;
            stage.status = "aborted";
            stage.finishedAt = finishedAt;
            stage.summary = result.agentRun.error ?? "Task was aborted.";
            run.error = "Native workflow run was aborted.";
            state.failed.add(step.id);
            return;
          }

          const message = result.agentRun.error ?? `Native workflow task ended with status ${result.agentRun.status}`;
          if (attempt < maxAttempts) {
            stage.summary = `Attempt ${attempt} failed; retrying.`;
            task.output = {
              agentRunId: result.agentRun.id,
              sessionId: result.agentRun.sessionId,
              agentStatus: result.agentRun.status,
              error: message,
              attempt,
              maxAttempts,
              retrying: true,
            };
            this.store.set(run);
            await sleep(backoffMs);
            continue;
          }

          task.status = "failed";
          task.finishedAt = finishedAt;
          stage.status = "failed";
          stage.finishedAt = finishedAt;
          stage.summary = message;
          run.error = message;
          state.failed.add(step.id);
          return;
        } catch (error) {
          const finishedAt = new Date().toISOString();
          const message = error instanceof Error ? error.message : String(error);
          if (task.agentRunId && message.includes("timed out")) {
            await this.abortAgentRun(task.agentRunId, run.projectId);
          }

          const artifact = createTaskErrorArtifact(run.id, task, step, message, finishedAt);
          task.artifactIds.push(artifact.id);
          run.artifacts.push(artifact);
          task.output = {
            error: message,
            attempt,
            maxAttempts,
            retrying: attempt < maxAttempts,
          };

          if (this.abortedRunIds.has(run.id)) {
            task.status = "aborted";
            task.finishedAt = finishedAt;
            stage.status = "aborted";
            stage.finishedAt = finishedAt;
            stage.summary = "Task was aborted.";
            run.error = "Native workflow run was aborted.";
            state.failed.add(step.id);
            return;
          }

          if (attempt < maxAttempts) {
            stage.summary = `Attempt ${attempt} failed; retrying.`;
            this.store.set(run);
            await sleep(backoffMs);
            continue;
          }

          task.status = "failed";
          task.finishedAt = finishedAt;
          stage.status = "failed";
          stage.finishedAt = finishedAt;
          stage.summary = message;
          run.error = message;
          state.failed.add(step.id);
          return;
        }
      }
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

  private listNativeDefinitions(project?: ProjectSummary) {
    const projectDefinitions = project ? loadProjectNativeWorkflowDefinitions(project.cwd) : [];
    const projectIds = new Set(projectDefinitions.map((definition) => definition.id));
    return [
      ...projectDefinitions,
      ...NATIVE_WORKFLOWS.filter((definition) => !projectIds.has(definition.id)),
    ];
  }

  private async abortAgentRun(agentRunId: string, projectId?: string) {
    try {
      await this.options.abortAgentRun?.(agentRunId, projectId);
    } catch {
      // Workflow abort is best-effort for underlying agent runs; the workflow run remains aborted.
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

async function withOptionalTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined, stepId: string) {
  if (!timeoutMs) return promise;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Native workflow task timed out after ${timeoutMs}ms: ${stepId}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sleep(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
