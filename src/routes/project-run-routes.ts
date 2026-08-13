import { jsonError, toStatus } from "../http";
import type { RouteDeps } from "./types";

export function registerProjectRunRoutes({ app, daemon }: RouteDeps) {
  app.get("/v1/projects/:projectId/runs", (c) => {
    try {
      return c.json({ runs: daemon.api.runApiService.listRuns(c.req.query("sessionId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/projects/:projectId/runs/:runId", (c) => {
    try {
      return c.json({ run: daemon.api.runApiService.getRun(c.req.param("runId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/projects/:projectId/runs/:runId/abort", async (c) => {
    try {
      return c.json({ run: await daemon.api.runApiService.abortRun(c.req.param("runId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/projects/:projectId/runs/:runId/events", (c) => {
    try {
      return c.json({
        events: daemon.api.runApiService.listRunEvents(c.req.param("runId"), c.req.query("afterEventId"), c.req.param("projectId")),
      });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });
}
