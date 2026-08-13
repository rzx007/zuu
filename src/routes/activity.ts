import type { EventStreamQuery, PromptStreamEvent } from "@zuu/client";
import { streamSSE } from "hono/streaming";
import { jsonError, toStatus } from "../server";
import { writePromptStreamEvent } from "./sse";
import type { RouteDeps } from "./types";

export function registerActivityRoutes({ app, daemon }: RouteDeps) {
  app.get("/v1/runs", (c) => {
    const sessionId = c.req.query("sessionId");
    const projectId = c.req.query("projectId");
    return c.json({ runs: daemon.api.runApiService.listRuns(sessionId, projectId) });
  });

  app.get("/v1/runs/:runId", (c) => {
    try {
      return c.json({ run: daemon.api.runApiService.getRun(c.req.param("runId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/runs/:runId/abort", async (c) => {
    try {
      return c.json({ run: await daemon.api.runApiService.abortRun(c.req.param("runId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/runs/:runId/events", (c) => {
    try {
      return c.json({ events: daemon.api.runApiService.listRunEvents(c.req.param("runId"), c.req.query("afterEventId")) });
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
      replayEvents = daemon.api.runApiService.listEvents(query);
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
      const unsubscribe = daemon.api.runApiService.subscribeEvents(liveQuery, (event) => {
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

}
