import type { Schedule, ScheduleRun } from "@zuu/client";

export interface ScheduleTriggerOptions {
  automatic?: boolean;
}

type RunningScheduleRun = ScheduleRun & { status: "running"; startedAt: string };
type QueuedScheduleRun = ScheduleRun & { status: "queued" };
type SkippedScheduleRun = ScheduleRun & { status: "skipped"; finishedAt: string };

export function createRunningScheduleRun(
  schedule: Schedule,
  previousNextRunAt: string | undefined,
  options: ScheduleTriggerOptions,
): RunningScheduleRun {
  const startedAt = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    scheduleId: schedule.id,
    status: "running",
    scheduledFor: scheduledFor(previousNextRunAt, options, startedAt),
    startedAt,
  };
}

export function createOverlapSkippedRun(
  schedule: Schedule,
  previousNextRunAt: string | undefined,
  options: ScheduleTriggerOptions,
): SkippedScheduleRun {
  return createSkippedRun(schedule, previousNextRunAt, options, "schedule_overlap");
}

export function createQueueFullSkippedRun(
  schedule: Schedule,
  previousNextRunAt: string | undefined,
  options: ScheduleTriggerOptions,
): SkippedScheduleRun {
  return createSkippedRun(schedule, previousNextRunAt, options, "schedule_queue_full");
}

export function createQueuedOverlapRun(
  schedule: Schedule,
  previousNextRunAt: string | undefined,
  options: ScheduleTriggerOptions,
  recordedAt = new Date().toISOString(),
): QueuedScheduleRun {
  return {
    id: crypto.randomUUID(),
    scheduleId: schedule.id,
    status: "queued",
    scheduledFor: scheduledFor(previousNextRunAt, options, recordedAt),
    reason: "schedule_overlap",
  };
}

export function createMisfireSkippedRun(schedule: Schedule): SkippedScheduleRun | undefined {
  if (!schedule.nextRunAt) return undefined;
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    scheduleId: schedule.id,
    status: "skipped",
    scheduledFor: schedule.nextRunAt,
    finishedAt: now,
    reason: "schedule_misfire",
  };
}

function createSkippedRun(
  schedule: Schedule,
  previousNextRunAt: string | undefined,
  options: ScheduleTriggerOptions,
  reason: ScheduleRun["reason"],
): SkippedScheduleRun {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    scheduleId: schedule.id,
    status: "skipped",
    scheduledFor: scheduledFor(previousNextRunAt, options, now),
    finishedAt: now,
    reason,
  };
}

function scheduledFor(previousNextRunAt: string | undefined, options: ScheduleTriggerOptions, fallback: string) {
  return options.automatic && previousNextRunAt ? previousNextRunAt : fallback;
}
