import type {
  PromptRequest,
  PromptStreamEvent,
  RunSummary,
  StartWorkflowRequest,
  WorkflowArtifact,
  WorkflowRun,
  WorkflowStage,
  WorkflowTask,
} from "@zuu/client";
import type { NativeWorkflowDefinition, NativeWorkflowStep } from "./native-definitions";

export interface NativeTaskResult {
  agentRun: RunSummary;
  text: string;
}

export type PromptEventRunner = (request: PromptRequest) => AsyncGenerator<PromptStreamEvent>;

export function createNativeWorkflowRun(
  definition: NativeWorkflowDefinition,
  request: StartWorkflowRequest = {},
  timestamp = new Date().toISOString(),
): WorkflowRun {
  const runId = crypto.randomUUID();
  const stages = definition.steps.map((step) => createNativeStage(runId, step));
  const tasks = definition.steps.map((step) => createNativeTask(runId, step));

  return {
    id: runId,
    workflowId: definition.id,
    workflowName: definition.name,
    status: "running",
    source: request.source ?? "user",
    projectId: request.projectId,
    sessionId: request.sessionId,
    prompt: request.prompt,
    startedAt: timestamp,
    stages,
    tasks,
    artifacts: [],
  };
}

export async function runPromptTask(
  runPrompt: PromptEventRunner,
  definition: NativeWorkflowDefinition,
  step: NativeWorkflowStep,
  request: StartWorkflowRequest,
  upstreamArtifacts: WorkflowArtifact[],
) {
  let finalRun: RunSummary | undefined;
  const textParts: string[] = [];

  for await (const event of runPrompt({
    prompt: buildTaskPrompt(definition, step, request, upstreamArtifacts),
    projectId: request.projectId,
    source: "workflow",
    name: `Workflow: ${definition.name} / ${step.name}`,
  })) {
    if (event.delta) textParts.push(event.delta);
    finalRun = event.run ?? finalRun;
  }

  if (!finalRun) throw new Error(`Native workflow task did not produce an agent run: ${step.id}`);
  return {
    agentRun: finalRun,
    text: textParts.join("").trim(),
  };
}

export function createTaskArtifact(
  runId: string,
  task: WorkflowTask,
  step: NativeWorkflowStep,
  result: NativeTaskResult,
  timestamp = new Date().toISOString(),
): WorkflowArtifact {
  return {
    id: `${runId}:artifact:${step.id}`,
    runId,
    taskId: task.id,
    name: `${step.id}.md`,
    kind: "text",
    mimeType: "text/markdown",
    content: [
      `# ${step.name}`,
      "",
      `Agent run: ${result.agentRun.id}`,
      `Agent status: ${result.agentRun.status}`,
      result.agentRun.error ? `Error: ${result.agentRun.error}` : undefined,
      "",
      result.text || "No assistant text was captured for this task.",
    ].filter(Boolean).join("\n"),
    createdAt: timestamp,
  };
}

export function getTaskDependencyArtifacts(
  step: NativeWorkflowStep,
  artifactsByStepId: Map<string, WorkflowArtifact>,
) {
  return (step.dependsOn ?? []).flatMap((dependencyId) => {
    const artifact = artifactsByStepId.get(dependencyId);
    return artifact ? [artifact] : [];
  });
}

function createNativeStage(runId: string, step: NativeWorkflowStep): WorkflowStage {
  return {
    id: `${runId}:stage:${step.id}`,
    runId,
    name: step.name,
    status: "queued",
  };
}

function createNativeTask(runId: string, step: NativeWorkflowStep): WorkflowTask {
  return {
    id: `${runId}:task:${step.id}`,
    runId,
    stageId: `${runId}:stage:${step.id}`,
    name: step.name,
    status: "queued",
    dependsOn: step.dependsOn ?? [],
    attempts: 0,
    input: {
      stepId: step.id,
      dependsOn: step.dependsOn ?? [],
    },
    artifactIds: [],
  };
}

function buildTaskPrompt(
  definition: NativeWorkflowDefinition,
  step: NativeWorkflowStep,
  request: StartWorkflowRequest,
  upstreamArtifacts: WorkflowArtifact[],
) {
  const parts = [
    `You are running a Zuu native workflow task.`,
    `Workflow: ${definition.name} (${definition.id})`,
    `Task: ${step.name} (${step.id})`,
    "",
    "User prompt:",
    request.prompt?.trim() || "No user prompt was provided.",
    "",
    "Task instructions:",
    step.prompt,
  ];

  if (request.inputs && Object.keys(request.inputs).length > 0) {
    parts.push("", "Workflow inputs:", JSON.stringify(request.inputs, null, 2));
  }

  if (upstreamArtifacts.length > 0) {
    parts.push("", "Upstream artifacts:");
    for (const artifact of upstreamArtifacts) {
      parts.push(`--- ${artifact.name} ---`, String(artifact.content ?? ""));
    }
  }

  parts.push("", "Return a concise result that can be saved as this task artifact.");
  return parts.join("\n");
}
