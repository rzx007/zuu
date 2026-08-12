import { readFileSync, writeFileSync } from "node:fs";
import type {
  StartWorkflowRequest,
  WorkflowArtifact,
  WorkflowBackendInfo,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowStage,
  WorkflowTask,
} from "@zuu/client";

const WORKFLOW_HISTORY_LIMIT = 200;

export interface WorkflowBackend {
  getInfo(): WorkflowBackendInfo;
  listDefinitions(): Promise<WorkflowDefinition[]>;
  start(workflowId: string, request: StartWorkflowRequest): Promise<WorkflowRun>;
  listRuns(): Promise<WorkflowRun[]>;
  getRun(runId: string): Promise<WorkflowRun>;
  abort(runId: string): Promise<WorkflowRun>;
}

interface WorkflowBackendOptions {
  path: string;
  packages: string[];
  requestedKind?: string;
}

const FAKE_WORKFLOWS: WorkflowDefinition[] = [
  {
    id: "project-review",
    name: "Project Review",
    description: "Inspect the current project shape and produce a review artifact.",
    version: "fake-0.1.0",
    tags: ["fake", "review"],
  },
  {
    id: "deep-research",
    name: "Deep Research",
    description: "Draft a research workflow outline without launching real subagents yet.",
    version: "fake-0.1.0",
    tags: ["fake", "research"],
  },
  {
    id: "release-notes",
    name: "Release Notes",
    description: "Summarize recent work into a release-note style artifact.",
    version: "fake-0.1.0",
    tags: ["fake", "docs"],
  },
];

function isWorkflowRun(value: unknown): value is WorkflowRun {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      "workflowId" in value &&
      "status" in value &&
      "stages" in value &&
      "tasks" in value &&
      "artifacts" in value,
  );
}

function loadWorkflowRuns(path: string): WorkflowRun[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isWorkflowRun) : [];
  } catch {
    return [];
  }
}

function saveWorkflowRuns(path: string, runs: WorkflowRun[]) {
  writeFileSync(path, `${JSON.stringify(runs.slice(0, WORKFLOW_HISTORY_LIMIT), null, 2)}\n`, "utf8");
}

function stage(
  runId: string,
  suffix: string,
  name: string,
  status: WorkflowRunStatus,
  timestamp: string,
  summary: string,
): WorkflowStage {
  return {
    id: `${runId}:${suffix}`,
    runId,
    name,
    status,
    startedAt: timestamp,
    endedAt: timestamp,
    summary,
  };
}

function task(
  runId: string,
  stageId: string,
  suffix: string,
  name: string,
  timestamp: string,
  input: unknown,
  output: unknown,
  artifactIds: string[] = [],
): WorkflowTask {
  return {
    id: `${runId}:${suffix}`,
    runId,
    stageId,
    name,
    status: "done",
    startedAt: timestamp,
    endedAt: timestamp,
    input,
    output,
    artifactIds,
  };
}

export class FakeWorkflowBackend implements WorkflowBackend {
  private readonly runs: Map<string, WorkflowRun>;

  constructor(
    private readonly path: string,
    private readonly info: WorkflowBackendInfo,
  ) {
    this.runs = new Map(loadWorkflowRuns(path).map((run) => [run.id, run]));
  }

  getInfo() {
    return this.info;
  }

  async listDefinitions() {
    return FAKE_WORKFLOWS;
  }

  async start(workflowId: string, request: StartWorkflowRequest = {}) {
    const definition = FAKE_WORKFLOWS.find((workflow) => workflow.id === workflowId);
    if (!definition) throw new Error(`Unknown workflow: ${workflowId}`);

    const now = new Date().toISOString();
    const runId = crypto.randomUUID();
    const intakeStage = stage(runId, "stage:intake", "Intake", "done", now, "Captured workflow inputs.");
    const planStage = stage(runId, "stage:plan", "Plan", "done", now, "Prepared a deterministic fake execution plan.");
    const artifactStage = stage(runId, "stage:artifact", "Artifact", "done", now, "Created a preview artifact.");
    const artifact: WorkflowArtifact = {
      id: `${runId}:artifact:summary`,
      runId,
      name: `${definition.id}-summary.md`,
      kind: "text",
      mimeType: "text/markdown",
      content: [
        `# ${definition.name}`,
        "",
        "This is a fake workflow run used to validate the Zuu workflow contract before binding a real Pi package.",
        "",
        `Prompt: ${request.prompt || "No prompt provided."}`,
        `Session: ${request.sessionId || "none"}`,
      ].join("\n"),
      createdAt: now,
    };

    const tasks = [
      task(runId, intakeStage.id, "task:intake", "Normalize input", now, request, { accepted: true }),
      task(runId, planStage.id, "task:plan", "Build stage plan", now, { workflowId }, { stages: 3, backend: "fake" }),
      task(
        runId,
        artifactStage.id,
        "task:artifact",
        "Write summary artifact",
        now,
        { artifact: artifact.name },
        { artifactId: artifact.id },
        [artifact.id],
      ),
    ];

    const run: WorkflowRun = {
      id: runId,
      workflowId: definition.id,
      workflowName: definition.name,
      status: "done",
      source: "user",
      sessionId: request.sessionId,
      prompt: request.prompt,
      startedAt: now,
      endedAt: now,
      stages: [intakeStage, planStage, artifactStage],
      tasks,
      artifacts: [artifact],
    };

    this.runs.set(run.id, run);
    this.persist();
    return run;
  }

  async listRuns() {
    return [...this.runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async getRun(runId: string) {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Unknown workflow run: ${runId}`);
    return run;
  }

  async abort(runId: string) {
    const run = await this.getRun(runId);
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
      this.persist();
    }
    return run;
  }

  private persist() {
    saveWorkflowRuns(this.path, [...this.runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)));
  }
}

class UnavailableWorkflowBackend implements WorkflowBackend {
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

function resolvePackage(packages: string[]) {
  return packages.find((source) => source.includes("@agwab/pi-workflow"));
}

export function createWorkflowBackend(options: WorkflowBackendOptions): WorkflowBackend {
  const packageSource = resolvePackage(options.packages);
  const packageInstalled = Boolean(packageSource);
  const requestedKind = options.requestedKind === "pi-package" ? "pi-package" : "fake";

  if (requestedKind === "pi-package") {
    return new UnavailableWorkflowBackend({
      kind: "pi-package",
      status: "unavailable",
      label: "Pi package workflow",
      packageInstalled,
      packageSource,
      message: packageInstalled
        ? "The @agwab/pi-workflow package is configured, but Zuu has not bound its run-state adapter yet."
        : "The @agwab/pi-workflow package is not configured. Add npm:@agwab/pi-workflow or use the fake backend.",
    });
  }

  return new FakeWorkflowBackend(options.path, {
    kind: "fake",
    status: "ready",
    label: "Fake workflow backend",
    packageInstalled,
    packageSource,
    message: packageInstalled
      ? "Fake backend is active; @agwab/pi-workflow is configured and ready for a future adapter."
      : "Fake backend is active; install @agwab/pi-workflow before enabling the real adapter.",
  });
}
