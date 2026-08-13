import type { ScheduleTrigger } from "@zuu/client";
import { assertObject, requireString, validationError } from "./http";

const MIN_SCHEDULE_INTERVAL_MS = 1_000;

export function parseScheduleTrigger(value: unknown): ScheduleTrigger {
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
