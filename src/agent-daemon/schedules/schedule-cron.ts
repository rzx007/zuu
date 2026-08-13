import { validationError } from "../../server";
import { matchesCronParts, parseCronExpression, type CronDateParts } from "./schedule-cron-expression";

const CRON_SEARCH_LIMIT_MINUTES = 366 * 24 * 60;
const timeZoneFormatters = new Map<string, Intl.DateTimeFormat>();

export function validateCronExpression(expression: unknown) {
  parseCronExpression(expression);
}

export function nextCronDate(expression: string | undefined, after: number, timeZone = "UTC") {
  const cron = parseCronExpression(expression);
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

export function validateTimeZone(timeZone: string) {
  try {
    getTimeZoneFormatter(timeZone);
  } catch {
    validationError("trigger.timezone must be a valid IANA timezone", { field: "trigger.timezone" });
  }
}

function matchesCronDate(date: Date, cron: ReturnType<typeof parseCronExpression>, timeZone = "UTC") {
  return matchesCronParts(timeZone === "UTC" ? utcDateParts(date) : zonedDateParts(date, timeZone), cron);
}

function utcDateParts(date: Date): CronDateParts {
  return {
    minute: date.getUTCMinutes(),
    hour: date.getUTCHours(),
    dayOfMonth: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    dayOfWeek: date.getUTCDay(),
  };
}

function zonedDateParts(date: Date, timeZone: string): CronDateParts {
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
