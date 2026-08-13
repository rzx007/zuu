import type { Schedule } from "@zuu/client";
import { notFound } from "../http";
import { compareScheduleRuns } from "./schedule-state";

export function sortSchedules(schedules: Iterable<Schedule>) {
  return [...schedules].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function listScheduleRuns(schedules: Iterable<Schedule>) {
  return [...schedules].flatMap((schedule) => schedule.runs).sort(compareScheduleRuns);
}

export function findScheduleForRun(schedules: Iterable<Schedule>, runId: string) {
  const schedule = sortSchedules(schedules).find((item) => item.runs.some((run) => run.id === runId));
  if (!schedule) notFound(`Unknown schedule run: ${runId}`, { runId });
  return schedule;
}
