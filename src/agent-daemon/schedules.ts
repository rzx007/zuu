import type {
  CreateScheduleRequest,
  Schedule,
  ScheduleAction,
  ScheduleRun,
  ScheduleTrigger,
} from "@zuu/client";
import { JsonFileStore } from "./json-file-store";

const SCHEDULE_RUN_HISTORY_LIMIT = 50;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const MIN_INTERVAL_MS = 1_000;

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
      "name" in value &&
      "status" in value &&
      "trigger" in value &&
      "action" in value &&
      "runs" in value,
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
    throw new Error("cron schedules are not supported yet");
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

function computeNextRunAt(trigger: ScheduleTrigger, after = Date.now()) {
  if (trigger.kind === "once") {
    const runAt = Date.parse(trigger.runAt ?? "");
    if (Number.isNaN(runAt)) return undefined;
    return runAt <= after ? new Date(after).toISOString() : new Date(runAt).toISOString();
  }

  if (trigger.kind === "interval" && typeof trigger.everyMs === "number") {
    return new Date(after + trigger.everyMs).toISOString();
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

  list() {
    return this.sortedSchedules();
  }

  get(scheduleId: string) {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) throw new Error(`Unknown schedule: ${scheduleId}`);
    return schedule;
  }

  create(request: CreateScheduleRequest) {
    validateTrigger(request.trigger);
    validateAction(request.action);

    const now = new Date().toISOString();
    const schedule: Schedule = {
      id: crypto.randomUUID(),
      name: request.name?.trim() || defaultScheduleName(request.action),
      status: "active",
      trigger: request.trigger,
      action: request.action,
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
      throw new Error("Schedule is already running");
    }

    const previousNextRunAt = schedule.nextRunAt;
    this.clearTimer(schedule.id);
    const run: ScheduleRun = {
      id: crypto.randomUUID(),
      scheduleId: schedule.id,
      status: "running",
      startedAt: new Date().toISOString(),
    };
    schedule.runs = [run, ...schedule.runs].slice(0, SCHEDULE_RUN_HISTORY_LIMIT);
    schedule.updatedAt = run.startedAt;
    this.persist();

    try {
      if (schedule.action.type === "prompt") {
        const result = await this.executor.runPrompt(schedule.action);
        run.agentRunId = result.agentRunId;
      } else {
        const result = await this.executor.runWorkflow(schedule.action);
        run.workflowRunId = result.workflowRunId;
      }
      run.status = "done";
    } catch (error) {
      run.status = "error";
      run.error = error instanceof Error ? error.message : String(error);
    } finally {
      const now = new Date().toISOString();
      run.endedAt = now;
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
    for (const schedule of this.schedules.values()) {
      if (schedule.status === "active" && !schedule.nextRunAt) {
        schedule.nextRunAt = computeNextRunAt(schedule.trigger);
      }
      this.arm(schedule);
    }
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

function defaultScheduleName(action: ScheduleAction) {
  return action.type === "workflow" ? `Workflow: ${action.workflowId}` : "Prompt schedule";
}
