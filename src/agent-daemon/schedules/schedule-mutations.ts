import type {
  CreateScheduleRequest,
  Schedule,
  UpdateScheduleRequest,
} from "@zuu/client";
import { defaultScheduleName } from "./schedule-state";
import { computeNextRunAt } from "./schedule-timing";
import { validateCreateScheduleRequest, validateUpdateScheduleRequest } from "./schedule-validation";

export function createScheduleRecord(request: CreateScheduleRequest): Schedule {
  validateCreateScheduleRequest(request);

  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: request.name?.trim() || defaultScheduleName(request.action),
    status: "active",
    trigger: request.trigger,
    action: request.action,
    overlapPolicy: request.overlapPolicy ?? "skip",
    misfirePolicy: request.misfirePolicy ?? "skip",
    retryPolicy: request.retryPolicy,
    createdAt: now,
    updatedAt: now,
    nextRunAt: computeNextRunAt(request.trigger),
    runs: [],
  };
}

export function applyScheduleUpdate(schedule: Schedule, request: UpdateScheduleRequest) {
  validateUpdateScheduleRequest(request);

  const triggerChanged = request.trigger !== undefined;
  if (request.name !== undefined) schedule.name = request.name.trim() || defaultScheduleName(request.action ?? schedule.action);
  if (request.trigger !== undefined) schedule.trigger = request.trigger;
  if (request.action !== undefined) schedule.action = request.action;
  if (request.overlapPolicy !== undefined) schedule.overlapPolicy = request.overlapPolicy;
  if (request.misfirePolicy !== undefined) schedule.misfirePolicy = request.misfirePolicy;
  if (request.retryPolicy !== undefined) schedule.retryPolicy = request.retryPolicy ?? undefined;
  schedule.updatedAt = new Date().toISOString();

  if (triggerChanged && schedule.status === "active") {
    schedule.nextRunAt = computeNextRunAt(schedule.trigger);
  }
}

export function pauseScheduleRecord(schedule: Schedule) {
  schedule.status = "paused";
  schedule.nextRunAt = undefined;
  schedule.updatedAt = new Date().toISOString();
}

export function resumeScheduleRecord(schedule: Schedule) {
  validateCreateScheduleRequest(schedule);
  schedule.status = "active";
  schedule.nextRunAt = computeNextRunAt(schedule.trigger);
  schedule.updatedAt = new Date().toISOString();
}
