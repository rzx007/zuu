import type { PromptRequest, PromptStreamEvent, RunSummary, StartWorkflowRequest, WorkflowRun } from "@zuu/client";
import type { ScheduleExecutor } from "./schedules";

interface ScheduleExecutorDeps {
  prompt(request: PromptRequest): AsyncGenerator<PromptStreamEvent>;
  startWorkflow(workflowId: string, request: StartWorkflowRequest): Promise<WorkflowRun> | WorkflowRun;
}

export function createDaemonScheduleExecutor(deps: ScheduleExecutorDeps): ScheduleExecutor {
  return {
    runPrompt: async (action) => {
      const { type: _type, ...request } = action;
      let agentRunId: string | undefined;
      for await (const event of deps.prompt({ ...request, source: "schedule" })) {
        agentRunId = event.run?.id ?? event.runId ?? agentRunId;
      }
      return { agentRunId };
    },
    runWorkflow: async (action) => {
      const run = await deps.startWorkflow(action.workflowId, {
        projectId: action.projectId,
        sessionId: action.sessionId,
        prompt: action.prompt,
        inputs: action.inputs,
        source: "schedule",
      });
      return { workflowRunId: run.id };
    },
  };
}

export async function launchPromptAsRun(prompt: (request: PromptRequest) => AsyncGenerator<PromptStreamEvent>, request: PromptRequest) {
  let finalRun: RunSummary | undefined;
  for await (const event of prompt(request)) {
    finalRun = event.run ?? finalRun;
  }
  if (!finalRun) throw new Error("Workflow launch did not produce an agent run");
  return finalRun;
}
