import type { CreateScheduleRequest, ScheduleAction, UpdateScheduleRequest } from "@zuu/client";
import { validationError } from "../../http";
import { isScheduleRetryPolicy, SCHEDULE_MISFIRE_POLICIES, SCHEDULE_OVERLAP_POLICIES } from "./schedule-records";
import { validateScheduleTrigger } from "./schedule-timing";

export function validateCreateScheduleRequest(request: CreateScheduleRequest) {
  validateScheduleTrigger(request.trigger);
  validateAction(request.action);
  validateOverlapPolicy(request.overlapPolicy);
  validateMisfirePolicy(request.misfirePolicy);
  validateRetryPolicy(request.retryPolicy);
}

export function validateUpdateScheduleRequest(request: UpdateScheduleRequest) {
  if (request.trigger !== undefined) validateScheduleTrigger(request.trigger);
  if (request.action !== undefined) validateAction(request.action);
  validateOverlapPolicy(request.overlapPolicy);
  validateMisfirePolicy(request.misfirePolicy);
  validateRetryPolicy(request.retryPolicy);
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    validationError(`${label} is required`, { field: label });
  }
}

function validateAction(action: ScheduleAction) {
  assertObject(action, "action");

  if (action.type === "prompt") {
    if (typeof action.prompt !== "string" || !action.prompt.trim()) {
      validationError("action.prompt is required", { field: "action.prompt" });
    }
    return;
  }

  if (action.type === "workflow") {
    if (typeof action.workflowId !== "string" || !action.workflowId.trim()) {
      validationError("action.workflowId is required", { field: "action.workflowId" });
    }
    return;
  }

  validationError("action.type must be prompt or workflow", { field: "action.type" });
}

function validateOverlapPolicy(overlapPolicy: CreateScheduleRequest["overlapPolicy"]) {
  if (overlapPolicy === undefined || SCHEDULE_OVERLAP_POLICIES.has(overlapPolicy)) return;
  validationError("overlapPolicy must be skip, queue, or parallel", { field: "overlapPolicy" });
}

function validateMisfirePolicy(misfirePolicy: CreateScheduleRequest["misfirePolicy"]) {
  if (misfirePolicy === undefined || SCHEDULE_MISFIRE_POLICIES.has(misfirePolicy)) return;
  validationError("misfirePolicy must be skip or run_once", { field: "misfirePolicy" });
}

function validateRetryPolicy(retryPolicy: CreateScheduleRequest["retryPolicy"] | UpdateScheduleRequest["retryPolicy"]) {
  if (retryPolicy === undefined || retryPolicy === null) return;
  if (!isScheduleRetryPolicy(retryPolicy)) {
    validationError("retryPolicy.maxAttempts must be 1-5 and retryPolicy.backoffMs must be 0-60000", { field: "retryPolicy" });
  }
}
