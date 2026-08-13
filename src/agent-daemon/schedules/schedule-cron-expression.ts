import { validationError } from "../../server";

export interface CronDateParts {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
}

interface CronExpression {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

export function parseCronExpression(expression: unknown): CronExpression {
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

export function matchesCronParts(parts: CronDateParts, cron: CronExpression) {
  return (
    cron.minutes.has(parts.minute) &&
    cron.hours.has(parts.hour) &&
    cron.daysOfMonth.has(parts.dayOfMonth) &&
    cron.months.has(parts.month) &&
    cron.daysOfWeek.has(parts.dayOfWeek)
  );
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
