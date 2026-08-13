import type { Schedule } from "@zuu/client";
import { handleScheduleOverlap } from "./schedule-overlap";
import { prependScheduleRun } from "./schedule-records";
import { createRunningScheduleRun, type ScheduleTriggerOptions } from "./schedule-run-factory";
import type { ScheduleExecutor } from "./schedule-runner";
import { executeScheduleRun, restoreNextRun, updateNextRun } from "./schedule-state";

export interface ScheduleTriggerEffects {
  clearTimer(scheduleId: string): void;
  persist(): void;
  arm(schedule: Schedule): void;
  drainQueued(schedule: Schedule): void;
}

export async function triggerSchedule(
  schedule: Schedule,
  executor: ScheduleExecutor,
  options: ScheduleTriggerOptions,
  effects: ScheduleTriggerEffects,
) {
  const overlapResult = handleScheduleOverlap(schedule, options, effects);
  if (overlapResult) return overlapResult;

  const previousNextRunAt = schedule.nextRunAt;
  if (!options.automatic) effects.clearTimer(schedule.id);
  const runningRun = createRunningScheduleRun(schedule, previousNextRunAt, options);
  prependScheduleRun(schedule, runningRun);
  schedule.updatedAt = runningRun.startedAt;
  if (options.automatic) {
    updateNextRun(schedule);
  }
  effects.persist();
  if (options.automatic) effects.arm(schedule);

  try {
    await executeScheduleRun(schedule, runningRun, executor);
  } finally {
    if (!options.automatic) {
      restoreNextRun(schedule, previousNextRunAt);
    }
    effects.persist();
    if (!options.automatic) effects.arm(schedule);
    effects.drainQueued(schedule);
  }

  return schedule;
}
