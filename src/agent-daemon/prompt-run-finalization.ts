import type { RunSummary } from "@zuu/client";
import type { RunEventDraft } from "./run-events";

export function failPromptRun(run: RunSummary, error: unknown, saveRun: (run: RunSummary) => void): RunEventDraft {
  const message = error instanceof Error ? error.message : String(error);
  run.status = run.status === "aborted" ? "aborted" : "failed";
  run.finishedAt = new Date().toISOString();
  run.error = message;
  saveRun(run);
  return { runId: run.id, type: "error", message, run };
}

export function completePromptRun(
  run: RunSummary,
  result: { sawError: boolean; streamErrorMessage?: string },
  saveRun: (run: RunSummary) => void,
): RunEventDraft {
  run.status = run.status === "aborted" ? "aborted" : result.sawError ? "failed" : "completed";
  run.finishedAt = new Date().toISOString();
  if (run.status === "failed") run.error = result.streamErrorMessage;
  saveRun(run);
  return { runId: run.id, type: "done", run };
}
