import type {
  CreateScheduleRequest,
  Schedule,
  UpdateScheduleRequest,
} from "@zuu/client";
import { notFound } from "../../server";
import { loadSchedules, saveSchedules } from "./schedule-records";
import { drainQueuedSchedule } from "./schedule-queue";
import { findScheduleForRun, listScheduleRuns, sortSchedules } from "./schedule-query";
import { rescheduleSchedules } from "./schedule-rescheduler";
import type { ScheduleLease } from "./schedule-lease";
import {
  applyScheduleUpdate,
  createScheduleRecord,
  pauseScheduleRecord,
  resumeScheduleRecord,
} from "./schedule-mutations";
import type { ScheduleExecutor } from "./schedule-runner";
import { abortScheduleRun } from "./schedule-abort";
import { ScheduleTimerRegistry } from "./schedule-timers";
import { triggerSchedule } from "./schedule-trigger";

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
    return listScheduleRuns(schedules);
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
    return abortScheduleRun(schedule, runId, {
      persist: () => this.persist(),
      drainQueued: (item) => this.drainQueued(item),
    });
  }

  create(request: CreateScheduleRequest) {
    const schedule = createScheduleRecord(request);
    this.schedules.set(schedule.id, schedule);
    this.persist();
    this.arm(schedule);
    return schedule;
  }

  update(scheduleId: string, request: UpdateScheduleRequest) {
    const schedule = this.get(scheduleId);
    this.clearTimer(schedule.id);
    applyScheduleUpdate(schedule, request);
    this.persist();
    this.arm(schedule);
    return schedule;
  }

  pause(scheduleId: string) {
    const schedule = this.get(scheduleId);
    this.clearTimer(schedule.id);
    pauseScheduleRecord(schedule);
    this.persist();
    return schedule;
  }

  resume(scheduleId: string) {
    const schedule = this.get(scheduleId);
    resumeScheduleRecord(schedule);
    this.persist();
    this.arm(schedule);
    return schedule;
  }

  async trigger(scheduleId: string, options: { automatic?: boolean } = {}) {
    const schedule = this.get(scheduleId);
    return triggerSchedule(schedule, this.executor, options, {
      clearTimer: (id) => this.clearTimer(id),
      persist: () => this.persist(),
      arm: (item) => this.arm(item),
      drainQueued: (item) => this.drainQueued(item),
    });
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

  private arm(schedule: Schedule) {
    this.timers.arm(schedule, () => {
      void this.trigger(schedule.id, { automatic: true });
    });
  }

  private clearTimer(scheduleId: string) {
    this.timers.clear(scheduleId);
  }

  private rescheduleAll() {
    rescheduleSchedules(this.schedules.values(), {
      arm: (schedule) => this.arm(schedule),
      persist: () => this.persist(),
    });
  }

  private sortedSchedules() {
    return sortSchedules(this.schedules.values());
  }

  private findScheduleForRun(runId: string) {
    return findScheduleForRun(this.schedules.values(), runId);
  }

  private persist() {
    saveSchedules(this.path, this.sortedSchedules());
  }
}
