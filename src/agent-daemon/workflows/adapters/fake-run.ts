import type {
  StartWorkflowRequest,
  WorkflowArtifact,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowStage,
  WorkflowTask,
} from "@zuu/client";

export function createFakeWorkflowRun(definition: WorkflowDefinition, request: StartWorkflowRequest = {}): WorkflowRun {
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
    task(runId, planStage.id, "task:plan", "Build stage plan", now, { workflowId: definition.id }, { stages: 3, backend: "fake" }),
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

  return {
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
