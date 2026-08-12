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
import { notFound } from "../../http";
import type { WorkflowBackend } from "./types";
import { WorkflowRunStore } from "./run-store";

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
    finishedAt: timestamp,
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
    status: "completed",
    startedAt: timestamp,
    finishedAt: timestamp,
    input,
    output,
    artifactIds,
  };
}

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

    const now = new Date().toISOString();
    const runId = crypto.randomUUID();
    const intakeStage = stage(runId, "stage:intake", "Intake", "completed", now, "Captured workflow inputs.");
    const planStage = stage(runId, "stage:plan", "Plan", "completed", now, "Prepared a deterministic fake execution plan.");
    const artifactStage = stage(runId, "stage:artifact", "Artifact", "completed", now, "Created a preview artifact.");
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
      status: "completed",
      source: request.source ?? "user",
      projectId: request.projectId,
      sessionId: request.sessionId,
      prompt: request.prompt,
      startedAt: now,
      finishedAt: now,
      stages: [intakeStage, planStage, artifactStage],
      tasks,
      artifacts: [artifact],
    };

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
