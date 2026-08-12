import type { CreateScheduleRequest } from "@zuu/client";
import type { ProjectStore } from "./projects";
import { ScheduleStore, type ScheduleExecutor } from "./schedules";

export interface ScheduleServiceOptions {
  path: string;
  projectStore: ProjectStore;
  executor: ScheduleExecutor;
}

export class ScheduleService {
  private readonly store: ScheduleStore;

  constructor(private readonly options: ScheduleServiceOptions) {
    this.store = new ScheduleStore(options.path, options.executor);
  }

  listSchedules(projectId?: string) {
    if (projectId) this.options.projectStore.get(projectId);
    return this.store.list(projectId);
  }

  createSchedule(request: CreateScheduleRequest, projectIdOverride?: string) {
    const projectId = this.options.projectStore.get(projectIdOverride ?? request.action.projectId).id;
    return this.store.create({
      ...request,
      action: {
        ...request.action,
        projectId,
      },
    });
  }

  getSchedule(scheduleId: string, projectId?: string) {
    if (projectId) this.options.projectStore.get(projectId);
    const schedule = this.store.get(scheduleId);
    if (projectId && schedule.action.projectId !== projectId) throw new Error(`Unknown schedule: ${scheduleId}`);
    return schedule;
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
