import type { CreateScheduleRequest, ScheduleRetryPolicy } from "@zuu/client";
import { assertObject, optionalString, optionalStringArray, validationError } from "./http";

const SCHEDULE_OVERLAP_POLICIES = new Set(["skip", "queue", "parallel"]);
const SCHEDULE_MISFIRE_POLICIES = new Set(["skip", "run_once"]);

export function parseSchedulePolicies(value: Record<string, unknown>) {
  const overlapPolicy = optionalString(value.overlapPolicy, "overlapPolicy");
  if (overlapPolicy !== undefined && !SCHEDULE_OVERLAP_POLICIES.has(overlapPolicy)) {
    validationError("overlapPolicy must be skip, queue, or parallel", { field: "overlapPolicy" });
  }
  const misfirePolicy = optionalString(value.misfirePolicy, "misfirePolicy");
  if (misfirePolicy !== undefined && !SCHEDULE_MISFIRE_POLICIES.has(misfirePolicy)) {
    validationError("misfirePolicy must be skip or run_once", { field: "misfirePolicy" });
  }
  return {
    overlapPolicy: overlapPolicy as CreateScheduleRequest["overlapPolicy"],
    misfirePolicy: misfirePolicy as CreateScheduleRequest["misfirePolicy"],
  };
}

export function parseScheduleRetryPolicy(value: unknown): ScheduleRetryPolicy | undefined {
  if (value === undefined) return undefined;
  assertObject(value, "retryPolicy");
  if (
    typeof value.maxAttempts !== "number" ||
    !Number.isInteger(value.maxAttempts) ||
    value.maxAttempts < 1 ||
    value.maxAttempts > 5
  ) {
    validationError("retryPolicy.maxAttempts must be an integer from 1 to 5", { field: "retryPolicy.maxAttempts" });
  }
  if (
    typeof value.backoffMs !== "number" ||
    !Number.isFinite(value.backoffMs) ||
    value.backoffMs < 0 ||
    value.backoffMs > 60_000
  ) {
    validationError("retryPolicy.backoffMs must be between 0 and 60000", { field: "retryPolicy.backoffMs" });
  }
  return {
    maxAttempts: value.maxAttempts,
    backoffMs: value.backoffMs,
    retryableCodes: optionalStringArray(value.retryableCodes, "retryPolicy.retryableCodes"),
  };
}
