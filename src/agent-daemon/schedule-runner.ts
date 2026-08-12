import type { Schedule, ScheduleAction, ScheduleRetryPolicy, ScheduleRun } from "@zuu/client";

type PromptAction = Extract<ScheduleAction, { type: "prompt" }>;
type WorkflowAction = Extract<ScheduleAction, { type: "workflow" }>;

export interface ScheduleExecutor {
  runPrompt(action: PromptAction): Promise<{ agentRunId?: string }>;
  runWorkflow(action: WorkflowAction): Promise<{ workflowRunId?: string }>;
}

export async function runScheduleAction(schedule: Schedule, run: ScheduleRun, executor: ScheduleExecutor) {
  const maxAttempts = schedule.retryPolicy?.maxAttempts ?? 1;
  const backoffMs = schedule.retryPolicy?.backoffMs ?? 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    run.attempts = attempt;
    try {
      if (schedule.action.type === "prompt") {
        const result = await executor.runPrompt(schedule.action);
        run.agentRunId = result.agentRunId;
      } else {
        const result = await executor.runWorkflow(schedule.action);
        run.workflowRunId = result.workflowRunId;
      }
      delete run.error;
      return;
    } catch (error) {
      run.error = error instanceof Error ? error.message : String(error);
      if (attempt >= maxAttempts || !isRetryableScheduleError(schedule.retryPolicy, error)) {
        throw error;
      }
      await delay(backoffMs);
    }
  }

  throw new Error("schedule retry policy did not produce an attempt");
}

function isRetryableScheduleError(retryPolicy: ScheduleRetryPolicy | undefined, error: unknown) {
  const retryableCodes = retryPolicy?.retryableCodes;
  if (!retryableCodes?.length) return true;
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
  return Boolean(code && retryableCodes.includes(code));
}

function delay(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
