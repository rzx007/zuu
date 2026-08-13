import type {
  RunSummary,
  StartWorkflowRequest,
  WorkflowArtifact,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowStage,
  WorkflowTask,
} from "@zuu/client";

export interface PiWorkflowLaunch {
  command: string;
  run: WorkflowRun;
  launchStage: WorkflowStage;
  launchTask: WorkflowTask;
}

export function createPiWorkflowLaunch(
  runId: string,
  definition: WorkflowDefinition,
  request: StartWorkflowRequest,
  timestamp: string,
): PiWorkflowLaunch {
  const command = buildWorkflowCommand(definition, request.prompt);
  const launchStage = stage(runId, "stage:launch", "Launch pi-workflow", timestamp);
  const launchTask = task(runId, launchStage.id, "task:launch", "Send /workflow command", timestamp, {
    command,
    workflowId: definition.id,
    sessionId: request.sessionId,
  });

  return {
    command,
    launchStage,
    launchTask,
    run: {
      id: runId,
      workflowId: definition.id,
      workflowName: definition.name,
      status: "running",
      source: request.source ?? "user",
      projectId: request.projectId,
      sessionId: request.sessionId,
      prompt: request.prompt,
      startedAt: timestamp,
      stages: [launchStage],
      tasks: [launchTask],
      artifacts: [],
    },
  };
}

export function createPiWorkflowLaunchArtifact(
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

function buildWorkflowCommand(definition: WorkflowDefinition, prompt?: string) {
  const taskInput = prompt?.trim() || `Run the ${definition.name} workflow for the current repository.`;
  return definition.id === "dynamic"
    ? `/workflow dynamic ${JSON.stringify(taskInput)}`
    : `/workflow run ${definition.id} ${JSON.stringify(taskInput)}`;
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
