import type { Schedule } from "@zuu/client";
import { notFound } from "../../http";

export interface ScheduleAbortEffects {
  persist(): void;
  drainQueued(schedule: Schedule): void;
}

export function abortScheduleRun(schedule: Schedule, runId: string, effects: ScheduleAbortEffects) {
  const run = schedule.runs.find((item) => item.id === runId);
  if (!run) notFound(`Unknown schedule run: ${runId}`, { runId });
  if (run.status !== "queued" && run.status !== "running") return run;

  const now = new Date().toISOString();
  run.status = "aborted";
  run.finishedAt = now;
  run.reason = "schedule_run_aborted";
  schedule.updatedAt = now;
  effects.persist();
  effects.drainQueued(schedule);
  return run;
}
