import { jsonError, readJson, toStatus } from "../http";
import {
  parseCreateProject,
  parseCreateSchedule,
  parseCreateSession,
  parseOpenSession,
  parseStartWorkflow,
  parseUpdateProject,
  parseUpdateSchedule,
  parseUpdateSession,
} from "../request-validation";
import type { RouteDeps } from "./types";

export function registerProjectRoutes({ app, daemon }: RouteDeps) {
  app.get("/v1/projects", (c) => c.json({ projects: daemon.listProjects() }));

  app.post("/v1/projects", async (c) => {
    try {
      const body = parseCreateProject(await readJson(c.req));
      return c.json({ project: daemon.createProject(body) }, 201);
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.get("/v1/projects/:projectId", (c) => {
    try {
      return c.json({ project: daemon.getProject(c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.patch("/v1/projects/:projectId", async (c) => {
    try {
      const body = parseUpdateProject(await readJson(c.req));
      return c.json({ project: daemon.updateProject(c.req.param("projectId"), body) });
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.delete("/v1/projects/:projectId", (c) => {
    try {
      return c.json({ project: daemon.deleteProject(c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.get("/v1/projects/:projectId/sessions", (c) => {
    try {
      return c.json({ sessions: daemon.listSessions(c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/projects/:projectId/sessions", async (c) => {
    try {
      const body = parseCreateSession(await readJson(c.req, { optional: true }));
      const session = await daemon.createSession({ ...body, projectId: c.req.param("projectId") });
      return c.json({ session: daemon.summarizeSession(session) }, 201);
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.get("/v1/projects/:projectId/sessions/:sessionId", (c) => {
    try {
      return c.json({ session: daemon.getSession(c.req.param("sessionId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.patch("/v1/projects/:projectId/sessions/:sessionId", async (c) => {
    try {
      const body = parseUpdateSession(await readJson(c.req));
      return c.json({ session: daemon.updateSession(c.req.param("sessionId"), body, c.req.param("projectId")) });
    } catch (error) {
      const fallbackStatus = error instanceof Error &&
        (error.message.startsWith("Unknown session") || error.message.includes("does not belong to project"))
        ? 404
        : 400;
      return c.json(jsonError(error, fallbackStatus), toStatus(error, fallbackStatus));
    }
  });

  app.delete("/v1/projects/:projectId/sessions/:sessionId", async (c) => {
    try {
      return c.json({ session: await daemon.deleteSession(c.req.param("sessionId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/projects/:projectId/session-files", async (c) => {
    try {
      return c.json({ sessions: await daemon.listStoredSessions(undefined, c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/projects/:projectId/sessions/open", async (c) => {
    try {
      const body = parseOpenSession(await readJson(c.req));
      const session = await daemon.openSession({ ...body, projectId: c.req.param("projectId") });
      return c.json({ session: daemon.summarizeSession(session) }, 201);
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.get("/v1/projects/:projectId/runs", (c) => {
    try {
      return c.json({ runs: daemon.listRuns(c.req.query("sessionId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/projects/:projectId/runs/:runId", (c) => {
    try {
      return c.json({ run: daemon.getRun(c.req.param("runId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/projects/:projectId/runs/:runId/abort", async (c) => {
    try {
      return c.json({ run: await daemon.abortRun(c.req.param("runId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/projects/:projectId/runs/:runId/events", (c) => {
    try {
      return c.json({
        events: daemon.listRunEvents(c.req.param("runId"), c.req.query("afterEventId"), c.req.param("projectId")),
      });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/projects/:projectId/workflows", async (c) => {
    try {
      return c.json(await daemon.listWorkflows(c.req.param("projectId")));
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/projects/:projectId/workflows/:workflowId/runs", async (c) => {
    try {
      const body = parseStartWorkflow(await readJson(c.req, { optional: true }));
      return c.json({ run: await daemon.startWorkflow(c.req.param("workflowId"), body, c.req.param("projectId")) }, 201);
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.get("/v1/projects/:projectId/workflow-runs", async (c) => {
    try {
      return c.json({ runs: await daemon.listWorkflowRuns(c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/projects/:projectId/workflow-runs/:runId", async (c) => {
    try {
      return c.json({ run: await daemon.getWorkflowRun(c.req.param("runId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/projects/:projectId/workflow-runs/:runId/stages", async (c) => {
    try {
      return c.json({ stages: await daemon.listWorkflowStages(c.req.param("runId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/projects/:projectId/workflow-runs/:runId/tasks", async (c) => {
    try {
      return c.json({ tasks: await daemon.listWorkflowTasks(c.req.param("runId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/projects/:projectId/artifacts/:artifactId", async (c) => {
    try {
      return c.json({ artifact: await daemon.getWorkflowArtifact(c.req.param("artifactId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/projects/:projectId/workflow-runs/:runId/abort", async (c) => {
    try {
      return c.json({ run: await daemon.abortWorkflowRun(c.req.param("runId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

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
