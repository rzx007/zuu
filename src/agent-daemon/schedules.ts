import type {
  CreateScheduleRequest,
  Schedule,
  ScheduleAction,
  ScheduleRetryPolicy,
  ScheduleRun,
  ScheduleTrigger,
  UpdateScheduleRequest,
} from "@zuu/client";
import { JsonFileStore } from "./json-file-store";
import type { ScheduleLease } from "./schedule-lease";

const SCHEDULE_RUN_HISTORY_LIMIT = 50;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const MIN_INTERVAL_MS = 1_000;
const CRON_SEARCH_LIMIT_MINUTES = 366 * 24 * 60;
const SCHEDULE_RUN_STATUSES = new Set(["queued", "running", "completed", "failed", "skipped", "aborted"]);
const SCHEDULE_OVERLAP_POLICIES = new Set(["skip", "queue", "parallel"]);
const SCHEDULE_MISFIRE_POLICIES = new Set(["skip", "run_once"]);
const timeZoneFormatters = new Map<string, Intl.DateTimeFormat>();

type PromptAction = Extract<ScheduleAction, { type: "prompt" }>;
type WorkflowAction = Extract<ScheduleAction, { type: "workflow" }>;

export interface ScheduleExecutor {
  runPrompt(action: PromptAction): Promise<{ agentRunId?: string }>;
  runWorkflow(action: WorkflowAction): Promise<{ workflowRunId?: string }>;
}

export interface ScheduleStoreOptions {
  lease?: ScheduleLease;
  leaseHeartbeatMs?: number;
}

function isSchedule(value: unknown): value is Schedule {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      typeof value.id === "string" &&
      "name" in value &&
      typeof value.name === "string" &&
      "status" in value &&
      "trigger" in value &&
      "action" in value &&
      "overlapPolicy" in value &&
      typeof value.overlapPolicy === "string" &&
      SCHEDULE_OVERLAP_POLICIES.has(value.overlapPolicy) &&
      "misfirePolicy" in value &&
      typeof value.misfirePolicy === "string" &&
      SCHEDULE_MISFIRE_POLICIES.has(value.misfirePolicy) &&
      (!("retryPolicy" in value) || value.retryPolicy === undefined || isScheduleRetryPolicy(value.retryPolicy)) &&
      "runs" in value &&
      Array.isArray(value.runs) &&
      value.runs.every(isScheduleRun) &&
      "createdAt" in value &&
      typeof value.createdAt === "string" &&
      "updatedAt" in value &&
      typeof value.updatedAt === "string",
  );
}

function isScheduleRetryPolicy(value: unknown): value is ScheduleRetryPolicy {
  return Boolean(
    value &&
      typeof value === "object" &&
      "maxAttempts" in value &&
      typeof value.maxAttempts === "number" &&
      Number.isInteger(value.maxAttempts) &&
      value.maxAttempts >= 1 &&
      value.maxAttempts <= 5 &&
      "backoffMs" in value &&
      typeof value.backoffMs === "number" &&
      Number.isFinite(value.backoffMs) &&
      value.backoffMs >= 0 &&
      value.backoffMs <= 60_000 &&
      (!("retryableCodes" in value) ||
        value.retryableCodes === undefined ||
        (Array.isArray(value.retryableCodes) && value.retryableCodes.every((code) => typeof code === "string"))),
  );
}

function isScheduleRun(value: unknown): value is ScheduleRun {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      typeof value.id === "string" &&
      "scheduleId" in value &&
      typeof value.scheduleId === "string" &&
      "status" in value &&
      SCHEDULE_RUN_STATUSES.has(String(value.status)) &&
      "scheduledFor" in value &&
      typeof value.scheduledFor === "string",
  );
}

function loadSchedules(path: string): Schedule[] {
  return createSchedulesStore(path).load(Array.isArray).filter(isSchedule);
}

function saveSchedules(path: string, schedules: Schedule[]) {
  createSchedulesStore(path).save(schedules);
}

function createSchedulesStore(path: string) {
  return new JsonFileStore<unknown[]>({
    name: "schedules",
    path,
    defaultValue: [],
    countRecords: (value) => value.length,
  });
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is required`);
  }
}

function assertValidDate(value: unknown, label: string) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO date string`);
  }
}

function validateTrigger(trigger: ScheduleTrigger) {
  assertObject(trigger, "trigger");

  if (trigger.kind === "once") {
    assertValidDate(trigger.runAt, "trigger.runAt");
    return;
  }

  if (trigger.kind === "interval") {
    if (typeof trigger.everyMs !== "number" || !Number.isFinite(trigger.everyMs) || trigger.everyMs < MIN_INTERVAL_MS) {
      throw new Error(`trigger.everyMs must be at least ${MIN_INTERVAL_MS}`);
    }
    return;
  }

  if (trigger.kind === "cron") {
    if (typeof trigger.timezone !== "string" || !trigger.timezone.trim()) {
      throw new Error("trigger.timezone is required for cron schedules");
    }
    validateTimeZone(trigger.timezone);
    parseCron(trigger.cron);
    return;
  }

  throw new Error("trigger.kind must be once, interval, or cron");
}

function validateAction(action: ScheduleAction) {
  assertObject(action, "action");

  if (action.type === "prompt") {
    if (typeof action.prompt !== "string" || !action.prompt.trim()) {
      throw new Error("action.prompt is required");
    }
    return;
  }

  if (action.type === "workflow") {
    if (typeof action.workflowId !== "string" || !action.workflowId.trim()) {
      throw new Error("action.workflowId is required");
    }
    return;
  }

  throw new Error("action.type must be prompt or workflow");
}

function validateOverlapPolicy(overlapPolicy: CreateScheduleRequest["overlapPolicy"]) {
  if (overlapPolicy === undefined || SCHEDULE_OVERLAP_POLICIES.has(overlapPolicy)) return;
  throw new Error("overlapPolicy must be skip, queue, or parallel");
}

function validateMisfirePolicy(misfirePolicy: CreateScheduleRequest["misfirePolicy"]) {
  if (misfirePolicy === undefined || SCHEDULE_MISFIRE_POLICIES.has(misfirePolicy)) return;
  throw new Error("misfirePolicy must be skip or run_once");
}

function validateRetryPolicy(retryPolicy: CreateScheduleRequest["retryPolicy"] | UpdateScheduleRequest["retryPolicy"]) {
  if (retryPolicy === undefined || retryPolicy === null) return;
  if (!isScheduleRetryPolicy(retryPolicy)) {
    throw new Error("retryPolicy.maxAttempts must be 1-5 and retryPolicy.backoffMs must be 0-60000");
  }
}

function computeNextRunAt(trigger: ScheduleTrigger, after = Date.now()) {
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
    if (!schedule) throw new Error(`Unknown schedule: ${scheduleId}`);
    return schedule;
  }

  getRun(runId: string) {
    const run = this.listRuns().find((item) => item.id === runId);
    if (!run) throw new Error(`Unknown schedule run: ${runId}`);
    return run;
  }

  abortRun(runId: string) {
    const schedule = this.findScheduleForRun(runId);
    const run = schedule.runs.find((item) => item.id === runId);
    if (!run) throw new Error(`Unknown schedule run: ${runId}`);
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
    validateTrigger(request.trigger);
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
    if (request.trigger !== undefined) validateTrigger(request.trigger);
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
    validateTrigger(schedule.trigger);
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
      await this.runScheduleAction(schedule, run);
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
      await this.runScheduleAction(schedule, run);
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

  private async runScheduleAction(schedule: Schedule, run: ScheduleRun) {
    const maxAttempts = schedule.retryPolicy?.maxAttempts ?? 1;
    const backoffMs = schedule.retryPolicy?.backoffMs ?? 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      run.attempts = attempt;
      try {
        if (schedule.action.type === "prompt") {
          const result = await this.executor.runPrompt(schedule.action);
          run.agentRunId = result.agentRunId;
        } else {
          const result = await this.executor.runWorkflow(schedule.action);
          run.workflowRunId = result.workflowRunId;
        }
        delete run.error;
        return;
      } catch (error) {
        run.error = error instanceof Error ? error.message : String(error);
        if (attempt >= maxAttempts || !isRetryableScheduleError(schedule.retryPolicy, error)) {
          throw error;
        }
        await delay(backoffMs);
      }
    }

    throw new Error("schedule retry policy did not produce an attempt");
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
    if (!schedule) throw new Error(`Unknown schedule run: ${runId}`);
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

function isRetryableScheduleError(retryPolicy: ScheduleRetryPolicy | undefined, error: unknown) {
  const retryableCodes = retryPolicy?.retryableCodes;
  if (!retryableCodes?.length) return true;
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
  return Boolean(code && retryableCodes.includes(code));
}

function delay(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

interface CronExpression {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

function parseCron(expression: unknown): CronExpression {
  if (typeof expression !== "string" || !expression.trim()) {
    throw new Error("trigger.cron is required");
  }
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error("trigger.cron must contain 5 fields");
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
    if (!trimmed) throw new Error(`trigger.cron ${label} field is invalid`);
    const [rangePart, stepPart] = trimmed.split("/", 2);
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) throw new Error(`trigger.cron ${label} step is invalid`);

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
    throw new Error(`trigger.cron ${label} range is invalid`);
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
  throw new Error("trigger.cron did not produce a run time within one year");
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
  getTimeZoneFormatter(timeZone);
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
