import type { PromptRequest, RunSummary } from "@zuu/client";

export function createRunSummary(input: { sessionId: string; projectId: string; request: PromptRequest }): RunSummary {
  return {
    id: crypto.randomUUID(),
    sessionId: input.sessionId,
    projectId: input.projectId,
    source: input.request.source ?? "user",
    status: "running",
    prompt: input.request.prompt,
    startedAt: new Date().toISOString(),
  };
}

export function abortActiveSessionRuns(runs: Iterable<RunSummary>, sessionId: string, finishedAt: string) {
  let changed = false;
  for (const run of runs) {
    if (run.sessionId === sessionId && (run.status === "running" || run.status === "waiting_approval")) {
      run.status = "aborted";
      run.finishedAt = finishedAt;
      changed = true;
    }
  }
  return changed;
}
