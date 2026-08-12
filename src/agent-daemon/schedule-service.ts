import type { CreateScheduleRequest, UpdateScheduleRequest } from "@zuu/client";
import type { ProjectRegistry } from "./project-service";
import { ScheduleLease } from "./schedule-lease";
import { ScheduleStore, type ScheduleExecutor } from "./schedules";

export interface ScheduleServiceOptions {
  path: string;
  leasePath?: string;
  projects: ProjectRegistry;
  executor: ScheduleExecutor;
}

export class ScheduleService {
  private readonly store: ScheduleStore;

  constructor(private readonly options: ScheduleServiceOptions) {
    this.store = new ScheduleStore(options.path, options.executor, {
      lease: options.leasePath ? new ScheduleLease(options.leasePath) : undefined,
    });
  }

  listSchedules(projectId?: string) {
    if (projectId) this.options.projects.get(projectId);
    return this.store.list(projectId);
  }

  createSchedule(request: CreateScheduleRequest, projectIdOverride?: string) {
    const projectId = this.options.projects.get(projectIdOverride ?? request.action.projectId).id;
    return this.store.create({
      ...request,
      action: {
        ...request.action,
        projectId,
      },
    });
  }

  updateSchedule(scheduleId: string, request: UpdateScheduleRequest, projectIdOverride?: string) {
    const existing = this.getSchedule(scheduleId, projectIdOverride);
    const projectId = this.options.projects.get(projectIdOverride ?? request.action?.projectId ?? existing.action.projectId).id;
    return this.store.update(scheduleId, {
      ...request,
      action: request.action
        ? {
            ...request.action,
            projectId,
          }
        : undefined,
    });
  }

  getSchedule(scheduleId: string, projectId?: string) {
    if (projectId) this.options.projects.get(projectId);
    const schedule = this.store.get(scheduleId);
    if (projectId && schedule.action.projectId !== projectId) throw new Error(`Unknown schedule: ${scheduleId}`);
    return schedule;
  }

  listScheduleRuns(scheduleId?: string, projectId?: string) {
    if (scheduleId) {
      return this.getSchedule(scheduleId, projectId).runs;
    }
    return this.listSchedules(projectId)
      .flatMap((schedule) => schedule.runs)
      .sort((a, b) => (b.startedAt ?? b.scheduledFor).localeCompare(a.startedAt ?? a.scheduledFor));
  }

  getScheduleRun(runId: string, projectId?: string) {
    const run = this.store.getRun(runId);
    this.getSchedule(run.scheduleId, projectId);
    return run;
  }

  abortScheduleRun(runId: string, projectId?: string) {
    const run = this.getScheduleRun(runId, projectId);
    return this.store.abortRun(run.id);
  }

  pauseSchedule(scheduleId: string, projectId?: string) {
    this.getSchedule(scheduleId, projectId);
    return this.store.pause(scheduleId);
  }

  resumeSchedule(scheduleId: string, projectId?: string) {
    this.getSchedule(scheduleId, projectId);
    return this.store.resume(scheduleId);
  }

  triggerSchedule(scheduleId: string, projectId?: string) {
    this.getSchedule(scheduleId, projectId);
    return this.store.trigger(scheduleId);
  }

  deleteSchedule(scheduleId: string, projectId?: string) {
    this.getSchedule(scheduleId, projectId);
    return this.store.delete(scheduleId);
  }

  dispose() {
    this.store.dispose();
  }
}
