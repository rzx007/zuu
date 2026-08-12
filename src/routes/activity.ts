import type { EventStreamQuery, PromptStreamEvent } from "@zuu/client";
import { streamSSE } from "hono/streaming";
import { jsonError, readJson, toStatus } from "../http";
import { parseCreateSchedule, parseStartWorkflow } from "../request-validation";
import { writePromptStreamEvent } from "./sse";
import type { RouteDeps } from "./types";

export function registerActivityRoutes({ app, daemon }: RouteDeps) {
  app.get("/v1/runs", (c) => {
    const sessionId = c.req.query("sessionId");
    const projectId = c.req.query("projectId");
    return c.json({ runs: daemon.listRuns(sessionId, projectId) });
  });

  app.get("/v1/runs/:runId", (c) => {
    try {
      return c.json({ run: daemon.getRun(c.req.param("runId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/runs/:runId/events", (c) => {
    try {
      return c.json({ events: daemon.listRunEvents(c.req.param("runId"), c.req.query("afterEventId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/events", (c) => {
    const query: EventStreamQuery = {
      runId: c.req.query("runId"),
      sessionId: c.req.query("sessionId"),
      afterEventId: c.req.query("afterEventId") ?? c.req.header("last-event-id"),
    };
    const liveQuery: EventStreamQuery = {
      runId: query.runId,
      sessionId: query.sessionId,
    };
    let replayEvents: PromptStreamEvent[];
    try {
      replayEvents = daemon.listEvents(query);
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }

    return streamSSE(c, async (stream) => {
      const queue: PromptStreamEvent[] = [];
      let notify: (() => void) | undefined;
      const wake = () => {
        notify?.();
        notify = undefined;
      };
      const unsubscribe = daemon.subscribeEvents(liveQuery, (event) => {
        queue.push(event);
        wake();
      });

      try {
        for (const event of replayEvents) {
          if (stream.aborted) return;
          await writePromptStreamEvent(stream, event);
        }

        while (!stream.aborted) {
          const event = queue.shift();
          if (event) {
            await writePromptStreamEvent(stream, event);
            continue;
          }

          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              notify = undefined;
              resolve();
            }, 15_000);
            notify = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          if (!queue.length && !stream.aborted) {
            await stream.writeSSE({ event: "heartbeat", data: "{}" });
          }
        }
      } finally {
        unsubscribe();
      }
    });
  });

  app.get("/v1/workflows", async (c) => {
    try {
      return c.json(await daemon.listWorkflows());
    } catch (error) {
      return c.json(jsonError(error, 500), toStatus(error, 500));
    }
  });

  app.post("/v1/workflows/:workflowId/runs", async (c) => {
    try {
      const body = parseStartWorkflow(await readJson(c.req, { optional: true }));
      return c.json({ run: await daemon.startWorkflow(c.req.param("workflowId"), body) }, 201);
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.get("/v1/workflow-runs", async (c) => {
    try {
      return c.json({ runs: await daemon.listWorkflowRuns(c.req.query("projectId")) });
    } catch (error) {
      const status = c.req.query("projectId") ? 404 : 500;
      return c.json(jsonError(error, status), toStatus(error, status));
    }
  });

  app.get("/v1/workflow-runs/:runId", async (c) => {
    try {
      return c.json({ run: await daemon.getWorkflowRun(c.req.param("runId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/workflow-runs/:runId/abort", async (c) => {
    try {
      return c.json({ run: await daemon.abortWorkflowRun(c.req.param("runId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

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
