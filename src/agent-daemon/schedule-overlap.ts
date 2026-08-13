import type { Schedule } from "@zuu/client";
import { prependScheduleRun } from "./schedule-records";
import {
  createOverlapSkippedRun,
  createQueueFullSkippedRun,
  createQueuedOverlapRun,
  type ScheduleTriggerOptions,
} from "./schedule-run-factory";
import { restoreNextRun, updateNextRun } from "./schedule-state";

export interface ScheduleOverlapEffects {
  clearTimer(scheduleId: string): void;
  persist(): void;
  arm(schedule: Schedule): void;
}

export function handleScheduleOverlap(
  schedule: Schedule,
  options: ScheduleTriggerOptions,
  effects: ScheduleOverlapEffects,
): Schedule | undefined {
  if (!schedule.runs.some((run) => run.status === "running")) return undefined;
  if (schedule.overlapPolicy === "skip") return skipOverlap(schedule, options, effects);
  if (schedule.overlapPolicy === "queue") return queueOverlap(schedule, options, effects);
  return undefined;
}

function skipOverlap(schedule: Schedule, options: ScheduleTriggerOptions, effects: ScheduleOverlapEffects) {
  const previousNextRunAt = schedule.nextRunAt;
  effects.clearTimer(schedule.id);
  const run = createOverlapSkippedRun(schedule, previousNextRunAt, options);
  prependScheduleRun(schedule, run);
  schedule.updatedAt = run.finishedAt;
  updateOverlapNextRun(schedule, previousNextRunAt, options);
  effects.persist();
  effects.arm(schedule);
  return schedule;
}

function queueOverlap(schedule: Schedule, options: ScheduleTriggerOptions, effects: ScheduleOverlapEffects) {
  if (schedule.runs.some((run) => run.status === "queued")) {
    return skipQueueFull(schedule, options, effects);
  }

  const previousNextRunAt = schedule.nextRunAt;
  const recordedAt = new Date().toISOString();
  effects.clearTimer(schedule.id);
  const run = createQueuedOverlapRun(schedule, previousNextRunAt, options, recordedAt);
  prependScheduleRun(schedule, run);
  schedule.updatedAt = recordedAt;
  updateOverlapNextRun(schedule, previousNextRunAt, options);
  effects.persist();
  effects.arm(schedule);
  return schedule;
}

function skipQueueFull(schedule: Schedule, options: ScheduleTriggerOptions, effects: ScheduleOverlapEffects) {
  const previousNextRunAt = schedule.nextRunAt;
  effects.clearTimer(schedule.id);
  const run = createQueueFullSkippedRun(schedule, previousNextRunAt, options);
  prependScheduleRun(schedule, run);
  schedule.updatedAt = run.finishedAt;
  updateOverlapNextRun(schedule, previousNextRunAt, options);
  effects.persist();
  effects.arm(schedule);
  return schedule;
}

function updateOverlapNextRun(schedule: Schedule, previousNextRunAt: string | undefined, options: ScheduleTriggerOptions) {
  if (options.automatic) {
    updateNextRun(schedule);
  } else {
    restoreNextRun(schedule, previousNextRunAt);
  }
}
