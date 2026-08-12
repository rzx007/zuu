import type {
  CreateScheduleRequest,
  Schedule,
  ScheduleAction,
  ScheduleRun,
  UpdateScheduleRequest,
} from "@zuu/client";
import { notFound, validationError } from "../http";
import {
  isScheduleRetryPolicy,
  loadSchedules,
  saveSchedules,
  SCHEDULE_MISFIRE_POLICIES,
  SCHEDULE_OVERLAP_POLICIES,
} from "./schedule-records";
import type { ScheduleLease } from "./schedule-lease";
import { runScheduleAction, type ScheduleExecutor } from "./schedule-runner";
import { computeNextRunAt, validateScheduleTrigger } from "./schedule-timing";

const SCHEDULE_RUN_HISTORY_LIMIT = 50;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
export type { ScheduleExecutor } from "./schedule-runner";

export interface ScheduleStoreOptions {
  lease?: ScheduleLease;
  leaseHeartbeatMs?: number;
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    validationError(`${label} is required`, { field: label });
  }
}

function validateAction(action: ScheduleAction) {
  assertObject(action, "action");

  if (action.type === "prompt") {
    if (typeof action.prompt !== "string" || !action.prompt.trim()) {
      validationError("action.prompt is required", { field: "action.prompt" });
    }
    return;
  }

  if (action.type === "workflow") {
    if (typeof action.workflowId !== "string" || !action.workflowId.trim()) {
      validationError("action.workflowId is required", { field: "action.workflowId" });
    }
    return;
  }

  validationError("action.type must be prompt or workflow", { field: "action.type" });
}

function validateOverlapPolicy(overlapPolicy: CreateScheduleRequest["overlapPolicy"]) {
  if (overlapPolicy === undefined || SCHEDULE_OVERLAP_POLICIES.has(overlapPolicy)) return;
  validationError("overlapPolicy must be skip, queue, or parallel", { field: "overlapPolicy" });
}

function validateMisfirePolicy(misfirePolicy: CreateScheduleRequest["misfirePolicy"]) {
  if (misfirePolicy === undefined || SCHEDULE_MISFIRE_POLICIES.has(misfirePolicy)) return;
  validationError("misfirePolicy must be skip or run_once", { field: "misfirePolicy" });
}

function validateRetryPolicy(retryPolicy: CreateScheduleRequest["retryPolicy"] | UpdateScheduleRequest["retryPolicy"]) {
  if (retryPolicy === undefined || retryPolicy === null) return;
  if (!isScheduleRetryPolicy(retryPolicy)) {
    validationError("retryPolicy.maxAttempts must be 1-5 and retryPolicy.backoffMs must be 0-60000", { field: "retryPolicy" });
  }
}

export class ScheduleStore {
  private readonly schedules: Map<string, Schedule>;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly lease?: ScheduleLease;
  private leaseHeld: boolean;
  private leaseHeartbeatTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly path: string,
    private readonly executor: ScheduleExecutor,
    options: ScheduleStoreOptions = {},
  ) {
    this.lease = options.lease;
    this.schedules = new Map(loadSchedules(path).map((schedule) => [schedule.id, schedule]));
    this.leaseHeld = this.lease ? this.lease.acquire() : true;
    if (this.lease) this.startLeaseHeartbeat(options.leaseHeartbeatMs);
    if (this.leaseHeld) this.rescheduleAll();
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
    validateScheduleTrigger(request.trigger);
    validateAction(request.action);
    validateOverlapPolicy(request.overlapPolicy);
    validateMisfirePolicy(request.misfirePolicy);
    validateRetryPolicy(request.retryPolicy);

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
    if (request.trigger !== undefined) validateScheduleTrigger(request.trigger);
    if (request.action !== undefined) validateAction(request.action);
    validateOverlapPolicy(request.overlapPolicy);
    validateMisfirePolicy(request.misfirePolicy);
    validateRetryPolicy(request.retryPolicy);

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
    validateScheduleTrigger(schedule.trigger);
    schedule.status = "active";
    schedule.nextRunAt = computeNextRunAt(schedule.trigger);
    schedule.updatedAt = new Date().toISOString();
    this.persist();
    this.arm(schedule);
    return schedule;
  }

  async trigger(scheduleId: string, options: { automatic?: boolean } = {}) {
    const schedule = this.get(scheduleId);
    if (schedule.runs.some((run) => run.status === "running")) {
      if (schedule.overlapPolicy === "skip") return this.skipOverlap(schedule, options);
      if (schedule.overlapPolicy === "queue") return this.queueOverlap(schedule, options);
    }

    const previousNextRunAt = schedule.nextRunAt;
    const startedAt = new Date().toISOString();
    if (!options.automatic) this.clearTimer(schedule.id);
    const run: ScheduleRun = {
      id: crypto.randomUUID(),
      scheduleId: schedule.id,
      status: "running",
      scheduledFor: options.automatic && previousNextRunAt ? previousNextRunAt : startedAt,
      startedAt,
    };
    schedule.runs = [run, ...schedule.runs].slice(0, SCHEDULE_RUN_HISTORY_LIMIT);
    schedule.updatedAt = startedAt;
    if (options.automatic) {
      this.updateNextRun(schedule);
    }
    this.persist();
    if (options.automatic) this.arm(schedule);

    try {
      await runScheduleAction(schedule, run, this.executor);
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
      if (!options.automatic) {
        this.restoreNextRun(schedule, previousNextRunAt);
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
    this.clearAllTimers();
    if (this.leaseHeartbeatTimer) clearInterval(this.leaseHeartbeatTimer);
    this.leaseHeartbeatTimer = undefined;
    this.lease?.release();
  }

  private updateNextRun(schedule: Schedule) {
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

  private skipOverlap(schedule: Schedule, options: { automatic?: boolean }) {
    const previousNextRunAt = schedule.nextRunAt;
    const now = new Date().toISOString();
    this.clearTimer(schedule.id);
    const run: ScheduleRun = {
      id: crypto.randomUUID(),
      scheduleId: schedule.id,
      status: "skipped",
      scheduledFor: options.automatic && previousNextRunAt ? previousNextRunAt : now,
      finishedAt: now,
      reason: "schedule_overlap",
    };
    schedule.runs = [run, ...schedule.runs].slice(0, SCHEDULE_RUN_HISTORY_LIMIT);
    schedule.updatedAt = now;
    if (options.automatic) {
      this.updateNextRun(schedule);
    } else {
      this.restoreNextRun(schedule, previousNextRunAt);
    }
    this.persist();
    this.arm(schedule);
    return schedule;
  }

  private queueOverlap(schedule: Schedule, options: { automatic?: boolean }) {
    if (schedule.runs.some((run) => run.status === "queued")) {
      return this.skipQueueFull(schedule, options);
    }

    const previousNextRunAt = schedule.nextRunAt;
    const now = new Date().toISOString();
    this.clearTimer(schedule.id);
    const run: ScheduleRun = {
      id: crypto.randomUUID(),
      scheduleId: schedule.id,
      status: "queued",
      scheduledFor: options.automatic && previousNextRunAt ? previousNextRunAt : now,
      reason: "schedule_overlap",
    };
    schedule.runs = [run, ...schedule.runs].slice(0, SCHEDULE_RUN_HISTORY_LIMIT);
    schedule.updatedAt = now;
    if (options.automatic) {
      this.updateNextRun(schedule);
    } else {
      this.restoreNextRun(schedule, previousNextRunAt);
    }
    this.persist();
    this.arm(schedule);
    return schedule;
  }

  private skipQueueFull(schedule: Schedule, options: { automatic?: boolean }) {
    const previousNextRunAt = schedule.nextRunAt;
    const now = new Date().toISOString();
    this.clearTimer(schedule.id);
    const run: ScheduleRun = {
      id: crypto.randomUUID(),
      scheduleId: schedule.id,
      status: "skipped",
      scheduledFor: options.automatic && previousNextRunAt ? previousNextRunAt : now,
      finishedAt: now,
      reason: "schedule_queue_full",
    };
    schedule.runs = [run, ...schedule.runs].slice(0, SCHEDULE_RUN_HISTORY_LIMIT);
    schedule.updatedAt = now;
    if (options.automatic) {
      this.updateNextRun(schedule);
    } else {
      this.restoreNextRun(schedule, previousNextRunAt);
    }
    this.persist();
    this.arm(schedule);
    return schedule;
  }

  private drainQueued(schedule: Schedule) {
    const queuedRun = [...schedule.runs]
      .filter((run) => run.status === "queued")
      .sort(compareScheduleRuns)
      .at(-1);
    if (!queuedRun || schedule.runs.some((run) => run.status === "running")) return;
    void this.runQueued(schedule, queuedRun);
  }

  private async runQueued(schedule: Schedule, run: ScheduleRun) {
    const previousNextRunAt = schedule.nextRunAt;
    const startedAt = new Date().toISOString();
    this.clearTimer(schedule.id);
    run.status = "running";
    run.startedAt = startedAt;
    schedule.updatedAt = startedAt;
    this.persist();

    try {
      await runScheduleAction(schedule, run, this.executor);
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
      this.restoreNextRun(schedule, previousNextRunAt);
      this.persist();
      this.arm(schedule);
      this.drainQueued(schedule);
    }
  }

  private skipMisfire(schedule: Schedule) {
    const missedRunAt = schedule.nextRunAt;
    if (!missedRunAt) return;

    const now = new Date().toISOString();
    const run: ScheduleRun = {
      id: crypto.randomUUID(),
      scheduleId: schedule.id,
      status: "skipped",
      scheduledFor: missedRunAt,
      finishedAt: now,
      reason: "schedule_misfire",
    };
    schedule.runs = [run, ...schedule.runs].slice(0, SCHEDULE_RUN_HISTORY_LIMIT);
    schedule.updatedAt = now;
    this.updateNextRun(schedule);
  }

  private arm(schedule: Schedule) {
    this.clearTimer(schedule.id);
    if (!this.canRunAutomaticTimers()) return;
    if (schedule.status !== "active" || !schedule.nextRunAt) return;

    const delay = Math.max(0, Math.min(Date.parse(schedule.nextRunAt) - Date.now(), MAX_TIMER_DELAY_MS));
    const timer = setTimeout(() => {
      void this.trigger(schedule.id, { automatic: true });
    }, delay);
    timer.unref?.();
    this.timers.set(schedule.id, timer);
  }

  private clearTimer(scheduleId: string) {
    const timer = this.timers.get(scheduleId);
    if (timer) clearTimeout(timer);
    this.timers.delete(scheduleId);
  }

  private clearAllTimers() {
    for (const scheduleId of this.timers.keys()) {
      this.clearTimer(scheduleId);
    }
  }

  private canRunAutomaticTimers() {
    return !this.lease || this.leaseHeld;
  }

  private startLeaseHeartbeat(heartbeatMs = 5_000) {
    this.leaseHeartbeatTimer = setInterval(() => {
      if (!this.lease) return;
      if (this.leaseHeld) {
        this.leaseHeld = this.lease.heartbeat();
        if (!this.leaseHeld) this.clearAllTimers();
        return;
      }

      this.leaseHeld = this.lease.acquire();
      if (this.leaseHeld) this.rescheduleAll();
    }, heartbeatMs);
    this.leaseHeartbeatTimer.unref?.();
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

  private restoreNextRun(schedule: Schedule, previousNextRunAt: string | undefined) {
    if (schedule.status !== "active") {
      schedule.nextRunAt = undefined;
      return;
    }

    if (previousNextRunAt && Date.parse(previousNextRunAt) > Date.now()) {
      schedule.nextRunAt = previousNextRunAt;
      return;
    }

    this.updateNextRun(schedule);
  }

  private persist() {
    saveSchedules(this.path, this.sortedSchedules());
  }
}

function compareScheduleRuns(a: ScheduleRun, b: ScheduleRun) {
  return (b.startedAt ?? b.scheduledFor).localeCompare(a.startedAt ?? a.scheduledFor);
}

function isScheduleRunAborted(run: ScheduleRun) {
  return run.status === "aborted";
}

function defaultScheduleName(action: ScheduleAction) {
  return action.type === "workflow" ? `Workflow: ${action.workflowId}` : "Prompt schedule";
}
