import type { CreateScheduleRequest, UpdateScheduleRequest } from "@zuu/client";
import { assertObject, optionalString } from "../server";
import { parseScheduleAction } from "./schedule-action-request-validation";
import { parseSchedulePolicies, parseScheduleRetryPolicy } from "./schedule-policy-request-validation";
import { parseScheduleTrigger } from "./schedule-trigger-request-validation";

export function parseCreateSchedule(value: unknown): CreateScheduleRequest {
  assertObject(value);
  return {
    name: optionalString(value.name, "name"),
    trigger: parseScheduleTrigger(value.trigger),
    action: parseScheduleAction(value.action),
    ...parseSchedulePolicies(value),
    retryPolicy: parseScheduleRetryPolicy(value.retryPolicy),
  };
}

export function parseUpdateSchedule(value: unknown): UpdateScheduleRequest {
  assertObject(value);
  return {
    name: optionalString(value.name, "name"),
    trigger: value.trigger === undefined ? undefined : parseScheduleTrigger(value.trigger),
    action: value.action === undefined ? undefined : parseScheduleAction(value.action),
    ...parseSchedulePolicies(value),
    retryPolicy: value.retryPolicy === null ? null : parseScheduleRetryPolicy(value.retryPolicy),
  };
}
