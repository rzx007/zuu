import type { ScheduleTrigger } from "@zuu/client";
import { validationError } from "../../http";
import { nextCronDate, validateCronExpression, validateTimeZone } from "./schedule-cron";

const MIN_INTERVAL_MS = 1_000;

export function validateScheduleTrigger(trigger: ScheduleTrigger) {
  assertObject(trigger, "trigger");

  if (trigger.kind === "once") {
    assertValidDate(trigger.runAt, "trigger.runAt");
    return;
  }

  if (trigger.kind === "interval") {
    if (typeof trigger.everyMs !== "number" || !Number.isFinite(trigger.everyMs) || trigger.everyMs < MIN_INTERVAL_MS) {
      validationError(`trigger.everyMs must be at least ${MIN_INTERVAL_MS}`, { field: "trigger.everyMs" });
    }
    return;
  }

  if (trigger.kind === "cron") {
    if (typeof trigger.timezone !== "string" || !trigger.timezone.trim()) {
      validationError("trigger.timezone is required for cron schedules", { field: "trigger.timezone" });
    }
    validateTimeZone(trigger.timezone);
    validateCronExpression(trigger.cron);
    return;
  }

  validationError("trigger.kind must be once, interval, or cron", { field: "trigger.kind" });
}

export function computeNextRunAt(trigger: ScheduleTrigger, after = Date.now()) {
  if (trigger.kind === "once") {
    const runAt = Date.parse(trigger.runAt ?? "");
    if (Number.isNaN(runAt)) return undefined;
    return runAt <= after ? new Date(after).toISOString() : new Date(runAt).toISOString();
  }

  if (trigger.kind === "interval" && typeof trigger.everyMs === "number") {
    return new Date(after + trigger.everyMs).toISOString();
  }

  if (trigger.kind === "cron") {
    const next = nextCronDate(trigger.cron, after, trigger.timezone);
    return next?.toISOString();
  }

  return undefined;
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    validationError(`${label} is required`, { field: label });
  }
}

function assertValidDate(value: unknown, label: string) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    validationError(`${label} must be an ISO date string`, { field: label });
  }
}
