import { jsonError, readJson, toStatus } from "../http";
import { parseCreateSchedule, parseUpdateSchedule } from "../schedule-request-validation";
import type { RouteDeps } from "./types";

export function registerProjectScheduleRoutes({ app, daemon }: RouteDeps) {
  app.get("/v1/projects/:projectId/schedules", (c) => {
    try {
      return c.json({ schedules: daemon.listSchedules(c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/projects/:projectId/schedules", async (c) => {
    try {
      const body = parseCreateSchedule(await readJson(c.req));
      return c.json({ schedule: daemon.createSchedule(body, c.req.param("projectId")) }, 201);
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.get("/v1/projects/:projectId/schedules/:scheduleId", (c) => {
    try {
      return c.json({ schedule: daemon.getSchedule(c.req.param("scheduleId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.patch("/v1/projects/:projectId/schedules/:scheduleId", async (c) => {
    try {
      const body = parseUpdateSchedule(await readJson(c.req));
      return c.json({
        schedule: daemon.updateSchedule(c.req.param("scheduleId"), body, c.req.param("projectId")),
      });
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.get("/v1/projects/:projectId/schedules/:scheduleId/runs", (c) => {
    try {
      return c.json({ runs: daemon.listScheduleRuns(c.req.param("scheduleId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/projects/:projectId/schedule-runs/:runId", (c) => {
    try {
      return c.json({ run: daemon.getScheduleRun(c.req.param("runId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/projects/:projectId/schedule-runs/:runId/abort", (c) => {
    try {
      return c.json({ run: daemon.abortScheduleRun(c.req.param("runId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/projects/:projectId/schedules/:scheduleId/pause", (c) => {
    try {
      return c.json({ schedule: daemon.pauseSchedule(c.req.param("scheduleId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/projects/:projectId/schedules/:scheduleId/resume", (c) => {
    try {
      return c.json({ schedule: daemon.resumeSchedule(c.req.param("scheduleId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.post("/v1/projects/:projectId/schedules/:scheduleId/trigger", async (c) => {
    try {
      return c.json({ schedule: await daemon.triggerSchedule(c.req.param("scheduleId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.delete("/v1/projects/:projectId/schedules/:scheduleId", (c) => {
    try {
      return c.json({ schedule: daemon.deleteSchedule(c.req.param("scheduleId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });
}
