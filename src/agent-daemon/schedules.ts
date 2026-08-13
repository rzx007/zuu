import type {
  CreateScheduleRequest,
  Schedule,
  UpdateScheduleRequest,
} from "@zuu/client";
import { notFound } from "../http";
import { loadSchedules, prependScheduleRun, saveSchedules } from "./schedule-records";
import {
  createMisfireSkippedRun,
  createRunningScheduleRun,
} from "./schedule-run-factory";
import { handleScheduleOverlap } from "./schedule-overlap";
import { drainQueuedSchedule } from "./schedule-queue";
import type { ScheduleLease } from "./schedule-lease";
import type { ScheduleExecutor } from "./schedule-runner";
import {
  compareScheduleRuns,
  defaultScheduleName,
  executeScheduleRun,
  restoreNextRun,
  updateNextRun,
} from "./schedule-state";
import { ScheduleTimerRegistry } from "./schedule-timers";
import { computeNextRunAt } from "./schedule-timing";
import { validateCreateScheduleRequest, validateUpdateScheduleRequest } from "./schedule-validation";

export type { ScheduleExecutor } from "./schedule-runner";

export interface ScheduleStoreOptions {
  lease?: ScheduleLease;
  leaseHeartbeatMs?: number;
}

export class ScheduleStore {
  private readonly schedules: Map<string, Schedule>;
  private readonly timers: ScheduleTimerRegistry;

  constructor(
    private readonly path: string,
    private readonly executor: ScheduleExecutor,
    options: ScheduleStoreOptions = {},
  ) {
    this.schedules = new Map(loadSchedules(path).map((schedule) => [schedule.id, schedule]));
    this.timers = new ScheduleTimerRegistry({
      lease: options.lease,
      leaseHeartbeatMs: options.leaseHeartbeatMs,
      onLeaseAcquired: () => this.rescheduleAll(),
    });
    if (this.timers.canRunAutomaticTimers()) this.rescheduleAll();
  }

  list(projectId?: string) {
    return this.sortedSchedules().filter((schedule) => !projectId || schedule.action.projectId === projectId);
  }

  listRuns(scheduleId?: string) {
    const schedules = scheduleId ? [this.get(scheduleId)] : this.sortedSchedules();
    return schedules.flatMap((schedule) => schedule.runs).sort(compareScheduleRuns);
  }

  get(scheduleId: string) {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) notFound(`Unknown schedule: ${scheduleId}`, { scheduleId });
    return schedule;
  }

  getRun(runId: string) {
    const run = this.listRuns().find((item) => item.id === runId);
    if (!run) notFound(`Unknown schedule run: ${runId}`, { runId });
    return run;
  }

  abortRun(runId: string) {
    const schedule = this.findScheduleForRun(runId);
    const run = schedule.runs.find((item) => item.id === runId);
    if (!run) notFound(`Unknown schedule run: ${runId}`, { runId });
    if (run.status !== "queued" && run.status !== "running") return run;

    const now = new Date().toISOString();
    run.status = "aborted";
    run.finishedAt = now;
    run.reason = "schedule_run_aborted";
    schedule.updatedAt = now;
    this.persist();
    this.drainQueued(schedule);
    return run;
  }

  create(request: CreateScheduleRequest) {
    validateCreateScheduleRequest(request);

    const now = new Date().toISOString();
    const schedule: Schedule = {
      id: crypto.randomUUID(),
      name: request.name?.trim() || defaultScheduleName(request.action),
      status: "active",
      trigger: request.trigger,
      action: request.action,
      overlapPolicy: request.overlapPolicy ?? "skip",
      misfirePolicy: request.misfirePolicy ?? "skip",
      retryPolicy: request.retryPolicy,
      createdAt: now,
      updatedAt: now,
      nextRunAt: computeNextRunAt(request.trigger),
      runs: [],
    };

    this.schedules.set(schedule.id, schedule);
    this.persist();
    this.arm(schedule);
    return schedule;
  }

  update(scheduleId: string, request: UpdateScheduleRequest) {
    const schedule = this.get(scheduleId);
    validateUpdateScheduleRequest(request);

    const triggerChanged = request.trigger !== undefined;
    if (request.name !== undefined) schedule.name = request.name.trim() || defaultScheduleName(request.action ?? schedule.action);
    if (request.trigger !== undefined) schedule.trigger = request.trigger;
    if (request.action !== undefined) schedule.action = request.action;
    if (request.overlapPolicy !== undefined) schedule.overlapPolicy = request.overlapPolicy;
    if (request.misfirePolicy !== undefined) schedule.misfirePolicy = request.misfirePolicy;
    if (request.retryPolicy !== undefined) schedule.retryPolicy = request.retryPolicy ?? undefined;
    schedule.updatedAt = new Date().toISOString();

    this.clearTimer(schedule.id);
    if (triggerChanged && schedule.status === "active") {
      schedule.nextRunAt = computeNextRunAt(schedule.trigger);
    }
    this.persist();
    this.arm(schedule);
    return schedule;
  }

  pause(scheduleId: string) {
    const schedule = this.get(scheduleId);
    this.clearTimer(schedule.id);
    schedule.status = "paused";
    schedule.nextRunAt = undefined;
    schedule.updatedAt = new Date().toISOString();
    this.persist();
    return schedule;
  }

  resume(scheduleId: string) {
    const schedule = this.get(scheduleId);
    validateCreateScheduleRequest(schedule);
    schedule.status = "active";
    schedule.nextRunAt = computeNextRunAt(schedule.trigger);
    schedule.updatedAt = new Date().toISOString();
    this.persist();
    this.arm(schedule);
    return schedule;
  }

  async trigger(scheduleId: string, options: { automatic?: boolean } = {}) {
    const schedule = this.get(scheduleId);
    const overlapResult = handleScheduleOverlap(schedule, options, {
      clearTimer: (id) => this.clearTimer(id),
      persist: () => this.persist(),
      arm: (item) => this.arm(item),
    });
    if (overlapResult) return overlapResult;

    const previousNextRunAt = schedule.nextRunAt;
    if (!options.automatic) this.clearTimer(schedule.id);
    const runningRun = createRunningScheduleRun(schedule, previousNextRunAt, options);
    prependScheduleRun(schedule, runningRun);
    schedule.updatedAt = runningRun.startedAt;
    if (options.automatic) {
      updateNextRun(schedule);
    }
    this.persist();
    if (options.automatic) this.arm(schedule);

    try {
      await executeScheduleRun(schedule, runningRun, this.executor);
    } finally {
      if (!options.automatic) {
        restoreNextRun(schedule, previousNextRunAt);
      }
      this.persist();
      if (!options.automatic) this.arm(schedule);
      this.drainQueued(schedule);
    }

    return schedule;
  }

  delete(scheduleId: string) {
    const schedule = this.get(scheduleId);
    this.clearTimer(scheduleId);
    this.schedules.delete(scheduleId);
    this.persist();
    return schedule;
  }

  dispose() {
    this.timers.dispose();
  }

  private drainQueued(schedule: Schedule) {
    drainQueuedSchedule(schedule, this.executor, {
      clearTimer: (id) => this.clearTimer(id),
      persist: () => this.persist(),
      arm: (item) => this.arm(item),
    });
  }

  private skipMisfire(schedule: Schedule) {
    const run = createMisfireSkippedRun(schedule);
    if (!run) return;
    prependScheduleRun(schedule, run);
    schedule.updatedAt = run.finishedAt;
    updateNextRun(schedule);
  }

  private arm(schedule: Schedule) {
    this.timers.arm(schedule, () => {
      void this.trigger(schedule.id, { automatic: true });
    });
  }

  private clearTimer(scheduleId: string) {
    this.timers.clear(scheduleId);
  }

  private rescheduleAll() {
    let changed = false;
    for (const schedule of this.schedules.values()) {
      if (schedule.status === "active" && !schedule.nextRunAt) {
        schedule.nextRunAt = computeNextRunAt(schedule.trigger);
        changed = true;
      }
      if (schedule.status === "active" && schedule.nextRunAt && Date.parse(schedule.nextRunAt) <= Date.now()) {
        if (schedule.misfirePolicy === "run_once") {
          this.arm(schedule);
        } else {
          this.skipMisfire(schedule);
          changed = true;
          this.arm(schedule);
        }
        continue;
      }
      this.arm(schedule);
    }
    if (changed) this.persist();
  }

  private sortedSchedules() {
    return [...this.schedules.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private findScheduleForRun(runId: string) {
    const schedule = this.sortedSchedules().find((item) => item.runs.some((run) => run.id === runId));
    if (!schedule) notFound(`Unknown schedule run: ${runId}`, { runId });
    return schedule;
  }

  private persist() {
    saveSchedules(this.path, this.sortedSchedules());
  }
}
