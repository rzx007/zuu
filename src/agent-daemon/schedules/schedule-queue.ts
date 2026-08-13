import type { Schedule, ScheduleRun } from "@zuu/client";
import type { ScheduleExecutor } from "./schedule-runner";
import { compareScheduleRuns, executeScheduleRun, restoreNextRun } from "./schedule-state";

export interface ScheduleQueueEffects {
  clearTimer(scheduleId: string): void;
  persist(): void;
  arm(schedule: Schedule): void;
}

export function drainQueuedSchedule(schedule: Schedule, executor: ScheduleExecutor, effects: ScheduleQueueEffects) {
  const queuedRun = latestQueuedRun(schedule);
  if (!queuedRun || schedule.runs.some((run) => run.status === "running")) return;
  void runQueuedSchedule(schedule, queuedRun, executor, effects);
}

function latestQueuedRun(schedule: Schedule) {
  return [...schedule.runs]
    .filter((run) => run.status === "queued")
    .sort(compareScheduleRuns)
    .at(-1);
}

async function runQueuedSchedule(
  schedule: Schedule,
  run: ScheduleRun,
  executor: ScheduleExecutor,
  effects: ScheduleQueueEffects,
) {
  const previousNextRunAt = schedule.nextRunAt;
  const startedAt = new Date().toISOString();
  effects.clearTimer(schedule.id);
  run.status = "running";
  run.startedAt = startedAt;
  schedule.updatedAt = startedAt;
  effects.persist();

  try {
    await executeScheduleRun(schedule, run, executor);
  } finally {
    restoreNextRun(schedule, previousNextRunAt);
    effects.persist();
    effects.arm(schedule);
    drainQueuedSchedule(schedule, executor, effects);
  }
}
