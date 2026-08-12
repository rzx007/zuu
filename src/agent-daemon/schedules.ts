import type {
  CreateScheduleRequest,
  Schedule,
  ScheduleAction,
  ScheduleRun,
  ScheduleTrigger,
  UpdateScheduleRequest,
} from "@zuu/client";
import { JsonFileStore } from "./json-file-store";

const SCHEDULE_RUN_HISTORY_LIMIT = 50;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const MIN_INTERVAL_MS = 1_000;
const CRON_SEARCH_LIMIT_MINUTES = 366 * 24 * 60;
const SCHEDULE_RUN_STATUSES = new Set(["queued", "running", "completed", "failed", "skipped", "aborted"]);
const SCHEDULE_OVERLAP_POLICIES = new Set(["skip"]);
const SCHEDULE_MISFIRE_POLICIES = new Set(["skip", "run_once"]);

type PromptAction = Extract<ScheduleAction, { type: "prompt" }>;
type WorkflowAction = Extract<ScheduleAction, { type: "workflow" }>;

export interface ScheduleExecutor {
  runPrompt(action: PromptAction): Promise<{ agentRunId?: string }>;
  runWorkflow(action: WorkflowAction): Promise<{ workflowRunId?: string }>;
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
      "runs" in value &&
      Array.isArray(value.runs) &&
      value.runs.every(isScheduleRun) &&
      "createdAt" in value &&
      typeof value.createdAt === "string" &&
      "updatedAt" in value &&
      typeof value.updatedAt === "string",
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
    if (trigger.timezone && trigger.timezone !== "UTC") {
      throw new Error("trigger.timezone is not supported yet; omit it or use UTC");
    }
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
  if (overlapPolicy === undefined || overlapPolicy === "skip") return;
  throw new Error("overlapPolicy queue and parallel are not supported yet; use skip");
}

function validateMisfirePolicy(misfirePolicy: CreateScheduleRequest["misfirePolicy"]) {
  if (misfirePolicy === undefined || SCHEDULE_MISFIRE_POLICIES.has(misfirePolicy)) return;
  throw new Error("misfirePolicy must be skip or run_once");
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
    const next = nextCronDate(trigger.cron, after);
    return next?.toISOString();
  }

  return undefined;
}

export class ScheduleStore {
  private readonly schedules: Map<string, Schedule>;
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly path: string,
    private readonly executor: ScheduleExecutor,
  ) {
    this.schedules = new Map(loadSchedules(path).map((schedule) => [schedule.id, schedule]));
    this.rescheduleAll();
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

  create(request: CreateScheduleRequest) {
    validateTrigger(request.trigger);
    validateAction(request.action);
    validateOverlapPolicy(request.overlapPolicy);
    validateMisfirePolicy(request.misfirePolicy);

    const now = new Date().toISOString();
    const schedule: Schedule = {
      id: crypto.randomUUID(),
      name: request.name?.trim() || defaultScheduleName(request.action),
      status: "active",
      trigger: request.trigger,
      action: request.action,
      overlapPolicy: request.overlapPolicy ?? "skip",
      misfirePolicy: request.misfirePolicy ?? "skip",
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

    const triggerChanged = request.trigger !== undefined;
    if (request.name !== undefined) schedule.name = request.name.trim() || defaultScheduleName(request.action ?? schedule.action);
    if (request.trigger !== undefined) schedule.trigger = request.trigger;
    if (request.action !== undefined) schedule.action = request.action;
    if (request.overlapPolicy !== undefined) schedule.overlapPolicy = request.overlapPolicy;
    if (request.misfirePolicy !== undefined) schedule.misfirePolicy = request.misfirePolicy;
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
      return this.skipOverlap(schedule, options);
    }

    const previousNextRunAt = schedule.nextRunAt;
    const startedAt = new Date().toISOString();
    this.clearTimer(schedule.id);
    const run: ScheduleRun = {
      id: crypto.randomUUID(),
      scheduleId: schedule.id,
      status: "running",
      scheduledFor: options.automatic && previousNextRunAt ? previousNextRunAt : startedAt,
      startedAt,
    };
    schedule.runs = [run, ...schedule.runs].slice(0, SCHEDULE_RUN_HISTORY_LIMIT);
    schedule.updatedAt = startedAt;
    this.persist();

    try {
      if (schedule.action.type === "prompt") {
        const result = await this.executor.runPrompt(schedule.action);
        run.agentRunId = result.agentRunId;
      } else {
        const result = await this.executor.runWorkflow(schedule.action);
        run.workflowRunId = result.workflowRunId;
      }
      run.status = "completed";
    } catch (error) {
      run.status = "failed";
      run.error = error instanceof Error ? error.message : String(error);
    } finally {
      const now = new Date().toISOString();
      run.finishedAt = now;
      schedule.lastRunAt = now;
      schedule.updatedAt = now;
      if (options.automatic) {
        this.updateNextRun(schedule);
      } else {
        this.restoreNextRun(schedule, previousNextRunAt);
      }
      this.persist();
      this.arm(schedule);
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
    for (const scheduleId of this.timers.keys()) {
      this.clearTimer(scheduleId);
    }
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

function defaultScheduleName(action: ScheduleAction) {
  return action.type === "workflow" ? `Workflow: ${action.workflowId}` : "Prompt schedule";
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

function nextCronDate(expression: string | undefined, after: number) {
  const cron = parseCron(expression);
  const cursor = new Date(after);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  for (let i = 0; i < CRON_SEARCH_LIMIT_MINUTES; i += 1) {
    if (matchesCronDate(cursor, cron)) return cursor;
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  throw new Error("trigger.cron did not produce a run time within one year");
}

function matchesCronDate(date: Date, cron: CronExpression) {
  return (
    cron.minutes.has(date.getUTCMinutes()) &&
    cron.hours.has(date.getUTCHours()) &&
    cron.daysOfMonth.has(date.getUTCDate()) &&
    cron.months.has(date.getUTCMonth() + 1) &&
    cron.daysOfWeek.has(date.getUTCDay())
  );
}
