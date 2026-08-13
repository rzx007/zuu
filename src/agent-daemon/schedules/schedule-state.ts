import type { Schedule, ScheduleAction, ScheduleRun } from "@zuu/client";
import { runScheduleAction, type ScheduleExecutor } from "./schedule-runner";
import { computeNextRunAt } from "./schedule-timing";

export function compareScheduleRuns(a: ScheduleRun, b: ScheduleRun) {
  return (b.startedAt ?? b.scheduledFor).localeCompare(a.startedAt ?? a.scheduledFor);
}

export function defaultScheduleName(action: ScheduleAction) {
  return action.type === "workflow" ? `Workflow: ${action.workflowId}` : "Prompt schedule";
}

export function isScheduleRunAborted(run: ScheduleRun) {
  return run.status === "aborted";
}

export function updateNextRun(schedule: Schedule) {
  if (schedule.status !== "active") {
    schedule.nextRunAt = undefined;
    return;
  }

  if (schedule.trigger.kind === "once") {
    schedule.status = "paused";
    schedule.nextRunAt = undefined;
    return;
  }

  schedule.nextRunAt = computeNextRunAt(schedule.trigger);
}

export function restoreNextRun(schedule: Schedule, previousNextRunAt: string | undefined) {
  if (schedule.status !== "active") {
    schedule.nextRunAt = undefined;
    return;
  }

  if (previousNextRunAt && Date.parse(previousNextRunAt) > Date.now()) {
    schedule.nextRunAt = previousNextRunAt;
    return;
  }

  updateNextRun(schedule);
}

export async function executeScheduleRun(schedule: Schedule, run: ScheduleRun, executor: ScheduleExecutor) {
  try {
    await runScheduleAction(schedule, run, executor);
    if (!isScheduleRunAborted(run)) run.status = "completed";
  } catch (error) {
    if (!isScheduleRunAborted(run)) {
      run.status = "failed";
      run.error = error instanceof Error ? error.message : String(error);
    }
  } finally {
    const now = new Date().toISOString();
    run.finishedAt = run.finishedAt ?? now;
    schedule.lastRunAt = now;
    schedule.updatedAt = now;
  }
}
