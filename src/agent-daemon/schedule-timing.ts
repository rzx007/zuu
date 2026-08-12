import type { ScheduleTrigger } from "@zuu/client";
import { validationError } from "../http";

const MIN_INTERVAL_MS = 1_000;
const CRON_SEARCH_LIMIT_MINUTES = 366 * 24 * 60;
const timeZoneFormatters = new Map<string, Intl.DateTimeFormat>();

interface CronExpression {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

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
    parseCron(trigger.cron);
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

function parseCron(expression: unknown): CronExpression {
  if (typeof expression !== "string" || !expression.trim()) {
    validationError("trigger.cron is required", { field: "trigger.cron" });
  }
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    validationError("trigger.cron must contain 5 fields", { field: "trigger.cron" });
  }

  return {
    minutes: parseCronField(fields[0], 0, 59, "minute"),
    hours: parseCronField(fields[1], 0, 23, "hour"),
    daysOfMonth: parseCronField(fields[2], 1, 31, "day-of-month"),
    months: parseCronField(fields[3], 1, 12, "month"),
    daysOfWeek: parseCronField(fields[4], 0, 7, "day-of-week"),
  };
}

function parseCronField(field: string, min: number, max: number, label: string) {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) validationError(`trigger.cron ${label} field is invalid`, { field: "trigger.cron" });
    const [rangePart, stepPart] = trimmed.split("/", 2);
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) {
      validationError(`trigger.cron ${label} step is invalid`, { field: "trigger.cron" });
    }

    const [start, end] = parseCronRange(rangePart, min, max, label);
    for (let value = start; value <= end; value += step) {
      values.add(label === "day-of-week" && value === 7 ? 0 : value);
    }
  }
  return values;
}

function parseCronRange(value: string, min: number, max: number, label: string): [number, number] {
  if (value === "*") return [min, max];
  const [startRaw, endRaw] = value.split("-", 2);
  const start = Number(startRaw);
  const end = endRaw === undefined ? start : Number(endRaw);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
    validationError(`trigger.cron ${label} range is invalid`, { field: "trigger.cron" });
  }
  return [start, end];
}

function nextCronDate(expression: string | undefined, after: number, timeZone = "UTC") {
  const cron = parseCron(expression);
  const cursor = new Date(after);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  const previousWallMinute = zonedMinuteKey(new Date(after), timeZone);

  for (let i = 0; i < CRON_SEARCH_LIMIT_MINUTES; i += 1) {
    if (matchesCronDate(cursor, cron, timeZone) && zonedMinuteKey(cursor, timeZone) !== previousWallMinute) return cursor;
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  validationError("trigger.cron did not produce a run time within one year", { field: "trigger.cron" });
}

function matchesCronDate(date: Date, cron: CronExpression, timeZone = "UTC") {
  const parts = timeZone === "UTC" ? utcDateParts(date) : zonedDateParts(date, timeZone);
  return (
    cron.minutes.has(parts.minute) &&
    cron.hours.has(parts.hour) &&
    cron.daysOfMonth.has(parts.dayOfMonth) &&
    cron.months.has(parts.month) &&
    cron.daysOfWeek.has(parts.dayOfWeek)
  );
}

function validateTimeZone(timeZone: string) {
  try {
    getTimeZoneFormatter(timeZone);
  } catch {
    validationError("trigger.timezone must be a valid IANA timezone", { field: "trigger.timezone" });
  }
}

function utcDateParts(date: Date) {
  return {
    minute: date.getUTCMinutes(),
    hour: date.getUTCHours(),
    dayOfMonth: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    dayOfWeek: date.getUTCDay(),
  };
}

function zonedDateParts(date: Date, timeZone: string) {
  const parts = Object.fromEntries(getTimeZoneFormatter(timeZone).formatToParts(date).map((part) => [part.type, part.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const dayOfMonth = Number(parts.day);
  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour),
    dayOfMonth,
    month,
    dayOfWeek: new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay(),
  };
}

function zonedMinuteKey(date: Date, timeZone: string) {
  if (timeZone === "UTC") {
    return date.toISOString().slice(0, 16);
  }
  const parts = Object.fromEntries(getTimeZoneFormatter(timeZone).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function getTimeZoneFormatter(timeZone: string) {
  const cached = timeZoneFormatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  timeZoneFormatters.set(timeZone, formatter);
  return formatter;
}
