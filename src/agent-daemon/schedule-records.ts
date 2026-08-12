import type { Schedule, ScheduleRetryPolicy, ScheduleRun } from "@zuu/client";
import { JsonFileStore } from "./json-file-store";

export const SCHEDULE_RUN_STATUSES = new Set(["queued", "running", "completed", "failed", "skipped", "aborted"]);
export const SCHEDULE_OVERLAP_POLICIES = new Set(["skip", "queue", "parallel"]);
export const SCHEDULE_MISFIRE_POLICIES = new Set(["skip", "run_once"]);

export function loadSchedules(path: string): Schedule[] {
  return createSchedulesStore(path).load(Array.isArray).filter(isSchedule);
}

export function saveSchedules(path: string, schedules: Schedule[]) {
  createSchedulesStore(path).save(schedules);
}

export function isScheduleRetryPolicy(value: unknown): value is ScheduleRetryPolicy {
  return Boolean(
    value &&
      typeof value === "object" &&
      "maxAttempts" in value &&
      typeof value.maxAttempts === "number" &&
      Number.isInteger(value.maxAttempts) &&
      value.maxAttempts >= 1 &&
      value.maxAttempts <= 5 &&
      "backoffMs" in value &&
      typeof value.backoffMs === "number" &&
      Number.isFinite(value.backoffMs) &&
      value.backoffMs >= 0 &&
      value.backoffMs <= 60_000 &&
      (!("retryableCodes" in value) ||
        value.retryableCodes === undefined ||
        (Array.isArray(value.retryableCodes) && value.retryableCodes.every((code) => typeof code === "string"))),
  );
}

function isSchedule(value: unknown): value is Schedule {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      typeof value.id === "string" &&
      "name" in value &&
      typeof value.name === "string" &&
      "status" in value &&
      "trigger" in value &&
      "action" in value &&
      "overlapPolicy" in value &&
      typeof value.overlapPolicy === "string" &&
      SCHEDULE_OVERLAP_POLICIES.has(value.overlapPolicy) &&
      "misfirePolicy" in value &&
      typeof value.misfirePolicy === "string" &&
      SCHEDULE_MISFIRE_POLICIES.has(value.misfirePolicy) &&
      (!("retryPolicy" in value) || value.retryPolicy === undefined || isScheduleRetryPolicy(value.retryPolicy)) &&
      "runs" in value &&
      Array.isArray(value.runs) &&
      value.runs.every(isScheduleRun) &&
      "createdAt" in value &&
      typeof value.createdAt === "string" &&
      "updatedAt" in value &&
      typeof value.updatedAt === "string",
  );
}

function isScheduleRun(value: unknown): value is ScheduleRun {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      typeof value.id === "string" &&
      "scheduleId" in value &&
      typeof value.scheduleId === "string" &&
      "status" in value &&
      SCHEDULE_RUN_STATUSES.has(String(value.status)) &&
      "scheduledFor" in value &&
      typeof value.scheduledFor === "string",
  );
}

function createSchedulesStore(path: string) {
  return new JsonFileStore<unknown[]>({
    name: "schedules",
    path,
    defaultValue: [],
    countRecords: (value) => value.length,
  });
}
