import type {
  CreateScheduleRequest,
  ScheduleAction,
  ScheduleRetryPolicy,
  ScheduleTrigger,
  UpdateScheduleRequest,
} from "@zuu/client";
import {
  assertObject,
  optionalBoolean,
  optionalRecord,
  optionalString,
  optionalStringArray,
  requireString,
  validationError,
} from "./http";
import { parseModel, parseThinkingLevel } from "./request-validation-common";

const SCHEDULE_OVERLAP_POLICIES = new Set(["skip", "queue", "parallel"]);
const SCHEDULE_MISFIRE_POLICIES = new Set(["skip", "run_once"]);
const MIN_SCHEDULE_INTERVAL_MS = 1_000;

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

function parseSchedulePolicies(value: Record<string, unknown>) {
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

function parseScheduleRetryPolicy(value: unknown): ScheduleRetryPolicy | undefined {
  if (value === undefined) return undefined;
  assertObject(value, "retryPolicy");
  if (typeof value.maxAttempts !== "number" || !Number.isInteger(value.maxAttempts) || value.maxAttempts < 1 || value.maxAttempts > 5) {
    validationError("retryPolicy.maxAttempts must be an integer from 1 to 5", { field: "retryPolicy.maxAttempts" });
  }
  if (typeof value.backoffMs !== "number" || !Number.isFinite(value.backoffMs) || value.backoffMs < 0 || value.backoffMs > 60_000) {
    validationError("retryPolicy.backoffMs must be between 0 and 60000", { field: "retryPolicy.backoffMs" });
  }
  return {
    maxAttempts: value.maxAttempts,
    backoffMs: value.backoffMs,
    retryableCodes: optionalStringArray(value.retryableCodes, "retryPolicy.retryableCodes"),
  };
}

function parseScheduleTrigger(value: unknown): ScheduleTrigger {
  assertObject(value, "trigger");
  const kind = requireString(value.kind, "trigger.kind");
  if (kind === "once") {
    const runAt = requireString(value.runAt, "trigger.runAt");
    if (Number.isNaN(Date.parse(runAt))) {
      validationError("trigger.runAt must be an ISO date string", { field: "trigger.runAt" });
    }
    return { kind, runAt };
  }
  if (kind === "interval") {
    if (
      typeof value.everyMs !== "number" ||
      !Number.isFinite(value.everyMs) ||
      value.everyMs < MIN_SCHEDULE_INTERVAL_MS
    ) {
      validationError(`trigger.everyMs must be at least ${MIN_SCHEDULE_INTERVAL_MS}`, { field: "trigger.everyMs" });
    }
    return { kind, everyMs: value.everyMs };
  }
  if (kind === "cron") {
    const timezone = requireString(value.timezone, "trigger.timezone");
    validateTimeZone(timezone);
    return {
      kind,
      cron: requireString(value.cron, "trigger.cron"),
      timezone,
    };
  }
  validationError("trigger.kind must be once, interval, or cron", { field: "trigger.kind" });
}

function validateTimeZone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    validationError("trigger.timezone must be a valid IANA timezone", { field: "trigger.timezone" });
  }
}

function parseScheduleAction(value: unknown): ScheduleAction {
  assertObject(value, "action");
  const type = requireString(value.type, "action.type");
  if (type === "prompt") {
    return {
      type,
      prompt: requireString(value.prompt, "action.prompt"),
      projectId: optionalString(value.projectId, "action.projectId"),
      sessionId: optionalString(value.sessionId, "action.sessionId"),
      name: optionalString(value.name, "action.name"),
      model: parseModel(value.model),
      thinkingLevel: parseThinkingLevel(value.thinkingLevel),
      tools: optionalStringArray(value.tools, "action.tools"),
      persist: optionalBoolean(value.persist, "action.persist"),
    };
  }
  if (type === "workflow") {
    return {
      type,
      workflowId: requireString(value.workflowId, "action.workflowId"),
      prompt: optionalString(value.prompt, "action.prompt"),
      projectId: optionalString(value.projectId, "action.projectId"),
      sessionId: optionalString(value.sessionId, "action.sessionId"),
      inputs: optionalRecord(value.inputs, "action.inputs"),
    };
  }
  validationError("action.type must be prompt or workflow", { field: "action.type" });
}
