import { jsonError, readJson, toStatus } from "../http";
import { parseCreateSchedule, parseUpdateSchedule } from "../schedule-request-validation";
import type { RouteDeps } from "./types";

export function registerScheduleRoutes({ app, daemon }: RouteDeps) {
  app.get("/v1/schedules", (c) => {
    try {
      return c.json({ schedules: daemon.listSchedules(c.req.query("projectId")) });
    } catch (error) {
      const status = c.req.query("projectId") ? 404 : 500;
      return c.json(jsonError(error, status), toStatus(error, status));
    }
  });

  app.post("/v1/schedules", async (c) => {
    try {
      const body = parseCreateSchedule(await readJson(c.req));
      return c.json({ schedule: daemon.createSchedule(body) }, 201);
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.get("/v1/schedules/:scheduleId", (c) => {
    try {
      return c.json({ schedule: daemon.getSchedule(c.req.param("scheduleId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.patch("/v1/schedules/:scheduleId", async (c) => {
    try {
      const body = parseUpdateSchedule(await readJson(c.req));
      return c.json({ schedule: daemon.updateSchedule(c.req.param("scheduleId"), body) });
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.get("/v1/schedules/:scheduleId/runs", (c) => {
    try {
      return c.json({ runs: daemon.listScheduleRuns(c.req.param("scheduleId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/schedule-runs/:runId", (c) => {
    try {
      return c.json({ run: daemon.getScheduleRun(c.req.param("runId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/schedule-runs/:runId/abort", (c) => {
    try {
      return c.json({ run: daemon.abortScheduleRun(c.req.param("runId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/schedules/:scheduleId/pause", (c) => {
    try {
      return c.json({ schedule: daemon.pauseSchedule(c.req.param("scheduleId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/schedules/:scheduleId/resume", (c) => {
    try {
      return c.json({ schedule: daemon.resumeSchedule(c.req.param("scheduleId")) });
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.post("/v1/schedules/:scheduleId/trigger", async (c) => {
    try {
      return c.json({ schedule: await daemon.triggerSchedule(c.req.param("scheduleId")) });
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.delete("/v1/schedules/:scheduleId", (c) => {
    try {
      return c.json({ schedule: daemon.deleteSchedule(c.req.param("scheduleId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });
}
