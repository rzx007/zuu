import type { Schedule } from "@zuu/client";
import { prependScheduleRun } from "./schedule-records";
import { createMisfireSkippedRun } from "./schedule-run-factory";
import { updateNextRun } from "./schedule-state";
import { computeNextRunAt } from "./schedule-timing";

export interface ScheduleReschedulerCallbacks {
  arm(schedule: Schedule): void;
  persist(): void;
}

export function rescheduleSchedules(schedules: Iterable<Schedule>, callbacks: ScheduleReschedulerCallbacks) {
  let changed = false;
  for (const schedule of schedules) {
    if (schedule.status === "active" && !schedule.nextRunAt) {
      schedule.nextRunAt = computeNextRunAt(schedule.trigger);
      changed = true;
    }
    if (schedule.status === "active" && schedule.nextRunAt && Date.parse(schedule.nextRunAt) <= Date.now()) {
      if (schedule.misfirePolicy === "run_once") {
        callbacks.arm(schedule);
      } else {
        changed = skipMisfire(schedule) || changed;
        callbacks.arm(schedule);
      }
      continue;
    }
    callbacks.arm(schedule);
  }
  if (changed) callbacks.persist();
}

function skipMisfire(schedule: Schedule) {
  const run = createMisfireSkippedRun(schedule);
  if (!run) return false;
  prependScheduleRun(schedule, run);
  schedule.updatedAt = run.finishedAt;
  updateNextRun(schedule);
  return true;
}
