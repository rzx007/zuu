import type { CreateScheduleRequest, UpdateScheduleRequest } from "@zuu/client";
import type { ScheduleService } from "../schedules/schedule-service";

export class ScheduleApiService {
  constructor(private readonly schedules: ScheduleService) {}

  listSchedules(projectId?: string) {
    return this.schedules.listSchedules(projectId);
  }

  createSchedule(request: CreateScheduleRequest, projectIdOverride?: string) {
    return this.schedules.createSchedule(request, projectIdOverride);
  }

  updateSchedule(scheduleId: string, request: UpdateScheduleRequest, projectIdOverride?: string) {
    return this.schedules.updateSchedule(scheduleId, request, projectIdOverride);
  }

  getSchedule(scheduleId: string, projectId?: string) {
    return this.schedules.getSchedule(scheduleId, projectId);
  }

  listScheduleRuns(scheduleId?: string, projectId?: string) {
    return this.schedules.listScheduleRuns(scheduleId, projectId);
  }

  getScheduleRun(runId: string, projectId?: string) {
    return this.schedules.getScheduleRun(runId, projectId);
  }

  abortScheduleRun(runId: string, projectId?: string) {
    return this.schedules.abortScheduleRun(runId, projectId);
  }

  pauseSchedule(scheduleId: string, projectId?: string) {
    return this.schedules.pauseSchedule(scheduleId, projectId);
  }

  resumeSchedule(scheduleId: string, projectId?: string) {
    return this.schedules.resumeSchedule(scheduleId, projectId);
  }

  triggerSchedule(scheduleId: string, projectId?: string) {
    return this.schedules.triggerSchedule(scheduleId, projectId);
  }

  deleteSchedule(scheduleId: string, projectId?: string) {
    return this.schedules.deleteSchedule(scheduleId, projectId);
  }
}
