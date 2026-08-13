import { jsonError, readJson, toStatus } from "../http";
import { parseCreateSchedule, parseUpdateSchedule } from "../schedule-request-validation";
import type { RouteDeps } from "./types";

export function registerScheduleRoutes({ app, daemon }: RouteDeps) {
  app.get("/v1/schedules", (c) => {
    try {
      return c.json({ schedules: daemon.api.scheduleApiService.listSchedules(c.req.query("projectId")) });
    } catch (error) {
      const status = c.req.query("projectId") ? 404 : 500;
      return c.json(jsonError(error, status), toStatus(error, status));
    }
  });

  app.post("/v1/schedules", async (c) => {
    try {
      const body = parseCreateSchedule(await readJson(c.req));
      return c.json({ schedule: daemon.api.scheduleApiService.createSchedule(body) }, 201);
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.get("/v1/schedules/:scheduleId", (c) => {
    try {
      return c.json({ schedule: daemon.api.scheduleApiService.getSchedule(c.req.param("scheduleId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.patch("/v1/schedules/:scheduleId", async (c) => {
    try {
      const body = parseUpdateSchedule(await readJson(c.req));
      return c.json({ schedule: daemon.api.scheduleApiService.updateSchedule(c.req.param("scheduleId"), body) });
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.get("/v1/schedules/:scheduleId/runs", (c) => {
    try {
      return c.json({ runs: daemon.api.scheduleApiService.listScheduleRuns(c.req.param("scheduleId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/schedule-runs/:runId", (c) => {
    try {
      return c.json({ run: daemon.api.scheduleApiService.getScheduleRun(c.req.param("runId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/schedule-runs/:runId/abort", (c) => {
    try {
      return c.json({ run: daemon.api.scheduleApiService.abortScheduleRun(c.req.param("runId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/schedules/:scheduleId/pause", (c) => {
    try {
      return c.json({ schedule: daemon.api.scheduleApiService.pauseSchedule(c.req.param("scheduleId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/schedules/:scheduleId/resume", (c) => {
    try {
      return c.json({ schedule: daemon.api.scheduleApiService.resumeSchedule(c.req.param("scheduleId")) });
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.post("/v1/schedules/:scheduleId/trigger", async (c) => {
    try {
      return c.json({ schedule: await daemon.api.scheduleApiService.triggerSchedule(c.req.param("scheduleId")) });
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.delete("/v1/schedules/:scheduleId", (c) => {
    try {
      return c.json({ schedule: daemon.api.scheduleApiService.deleteSchedule(c.req.param("scheduleId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });
}
