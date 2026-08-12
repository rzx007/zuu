import type {
  PromptRequest,
  RunSummary,
  StartWorkflowRequest,
  WorkflowArtifact,
  WorkflowBackendInfo,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowStage,
  WorkflowTask,
} from "@zuu/client";
import type { WorkflowBackend } from "./types";
import { WorkflowRunStore } from "./run-store";

const PI_WORKFLOW_PACKAGE = "@agwab/pi-workflow";

export const PI_WORKFLOW_DEFINITIONS: WorkflowDefinition[] = [
  {
    id: "deep-research",
    name: "Deep Research",
    description: "Bundled pi-workflow research process with planning, fan-out, verification, and synthesis.",
    version: "pi-package",
    tags: ["pi-workflow", "research"],
  },
  {
    id: "deep-review",
    name: "Deep Review",
    description: "Bundled pi-workflow code/design review process with multiple lenses and deduplication.",
    version: "pi-package",
    tags: ["pi-workflow", "review"],
  },
  {
    id: "spec-review",
    name: "Spec Review",
    description: "Bundled pi-workflow traceability pass for specs, APIs, and acceptance criteria.",
    version: "pi-package",
    tags: ["pi-workflow", "spec"],
  },
  {
    id: "impact-review",
    name: "Impact Review",
    description: "Bundled pi-workflow side-effect and regression-risk review for proposed or applied changes.",
    version: "pi-package",
    tags: ["pi-workflow", "risk"],
  },
  {
    id: "dynamic",
    name: "Dynamic Workflow",
    description: "Ask pi-workflow to plan an adaptive one-off workflow for this task.",
    version: "pi-package",
    tags: ["pi-workflow", "dynamic"],
  },
];

export interface PiWorkflowPackageProbe {
  packageSource?: string;
  packageInstalled: boolean;
  installedPath?: string;
  platform: NodeJS.Platform;
}

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
    if (!definition) throw new Error(`Unknown workflow: ${workflowId}`);

    const now = new Date().toISOString();
    const runId = crypto.randomUUID();
    const command = buildWorkflowCommand(definition, request.prompt);
    const launchStage = stage(runId, "stage:launch", "Launch pi-workflow", now);
    const launchTask = task(runId, launchStage.id, "task:launch", "Send /workflow command", now, {
      command,
      workflowId,
      sessionId: request.sessionId,
    });
    const run: WorkflowRun = {
      id: runId,
      workflowId: definition.id,
      workflowName: definition.name,
      status: "running",
      source: request.source ?? "user",
      projectId: request.projectId,
      sessionId: request.sessionId,
      prompt: request.prompt,
      startedAt: now,
      stages: [launchStage],
      tasks: [launchTask],
      artifacts: [],
    };
    this.store.set(run);

    try {
      const agentRun = await this.options.launchPrompt({
        prompt: command,
        projectId: request.projectId,
        sessionId: request.sessionId,
        name: `Workflow: ${definition.name}`,
      });
      const endedAt = new Date().toISOString();
      const artifact = launchArtifact(runId, launchTask.id, definition, command, agentRun, endedAt);

      run.status = agentRun.status === "done" ? "done" : agentRun.status === "aborted" ? "aborted" : "error";
      run.endedAt = endedAt;
      run.artifacts = [artifact];
      launchStage.status = run.status;
      launchStage.endedAt = endedAt;
      launchStage.summary =
        run.status === "done"
          ? "pi-workflow launch command completed. Detailed board state remains owned by the Pi workflow extension."
          : `pi-workflow launch command ended with agent status ${agentRun.status}.`;
      launchTask.status = run.status;
      launchTask.endedAt = endedAt;
      launchTask.output = {
        agentRunId: agentRun.id,
        agentStatus: agentRun.status,
      };
      launchTask.artifactIds = [artifact.id];
      if (run.status === "error") {
        run.error = `pi-workflow launch command ended with agent status ${agentRun.status}`;
      }
    } catch (error) {
      const endedAt = new Date().toISOString();
      run.status = "error";
      run.endedAt = endedAt;
      run.error = error instanceof Error ? error.message : String(error);
      launchStage.status = "error";
      launchStage.endedAt = endedAt;
      launchStage.summary = run.error;
      launchTask.status = "error";
      launchTask.endedAt = endedAt;
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
      run.endedAt = now;
      for (const stageItem of run.stages) {
        if (stageItem.status === "queued" || stageItem.status === "running") {
          stageItem.status = "aborted";
          stageItem.endedAt = now;
        }
      }
      for (const taskItem of run.tasks) {
        if (taskItem.status === "queued" || taskItem.status === "running") {
          taskItem.status = "aborted";
          taskItem.endedAt = now;
        }
      }
      this.store.persist();
    }
    return run;
  }
}

export function resolvePiWorkflowPackage(packages: string[]) {
  return packages.find((source) => source.includes(PI_WORKFLOW_PACKAGE));
}

export function createPiPackageInfo(probe: PiWorkflowPackageProbe): WorkflowBackendInfo {
  if (!probe.packageSource) {
    return {
      kind: "pi-package",
      status: "unavailable",
      label: "Pi package workflow",
      packageInstalled: false,
      message: `The ${PI_WORKFLOW_PACKAGE} package is not configured. Add npm:${PI_WORKFLOW_PACKAGE} or use the fake backend.`,
    };
  }

  if (probe.platform === "win32") {
    return {
      kind: "pi-package",
      status: "unavailable",
      label: "Pi package workflow",
      packageInstalled: probe.packageInstalled,
      packageSource: probe.packageSource,
      message: `${PI_WORKFLOW_PACKAGE} is configured, but its package page says native Windows is not supported. Use WSL2/Linux or switch ZUU_WORKFLOW_BACKEND=fake.`,
    };
  }

  if (!probe.installedPath) {
    return {
      kind: "pi-package",
      status: "unavailable",
      label: "Pi package workflow",
      packageInstalled: probe.packageInstalled,
      packageSource: probe.packageSource,
      message: `${PI_WORKFLOW_PACKAGE} is configured but was not resolved to an installed package path. Run pi install npm:${PI_WORKFLOW_PACKAGE}, then restart Zuu.`,
    };
  }

  return {
    kind: "pi-package",
    status: "ready",
    label: "Pi package workflow",
    packageInstalled: true,
    packageSource: probe.packageSource,
    message:
      "Pi package workflow adapter is ready. Zuu will launch workflows through /workflow commands; detailed run-state still belongs to the Pi workflow board.",
  };
}

function buildWorkflowCommand(definition: WorkflowDefinition, prompt?: string) {
  const task = prompt?.trim() || `Run the ${definition.name} workflow for the current repository.`;
  return definition.id === "dynamic"
    ? `/workflow dynamic ${JSON.stringify(task)}`
    : `/workflow run ${definition.id} ${JSON.stringify(task)}`;
}

function stage(runId: string, suffix: string, name: string, timestamp: string): WorkflowStage {
  return {
    id: `${runId}:${suffix}`,
    runId,
    name,
    status: "running",
    startedAt: timestamp,
  };
}

function task(runId: string, stageId: string, suffix: string, name: string, timestamp: string, input: unknown): WorkflowTask {
  return {
    id: `${runId}:${suffix}`,
    runId,
    stageId,
    name,
    status: "running",
    startedAt: timestamp,
    input,
    artifactIds: [],
  };
}

function launchArtifact(
  runId: string,
  taskId: string,
  definition: WorkflowDefinition,
  command: string,
  agentRun: RunSummary,
  timestamp: string,
): WorkflowArtifact {
  return {
    id: `${runId}:artifact:launch`,
    runId,
    taskId,
    name: `${definition.id}-launch.json`,
    kind: "json",
    mimeType: "application/json",
    content: {
      adapter: "pi-package",
      command,
      agentRunId: agentRun.id,
      agentRunStatus: agentRun.status,
      note: "Zuu launched pi-workflow through the Pi slash-command extension. Read detailed workflow board state from pi-workflow.",
    },
    createdAt: timestamp,
  };
}
