import { jsonError, readJson, toStatus } from "../http";
import { parseStartWorkflow } from "../request-validation";
import type { RouteDeps } from "./types";

export function registerWorkflowRoutes({ app, daemon }: RouteDeps) {
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

  app.get("/v1/workflow-runs/:runId/stages", async (c) => {
    try {
      return c.json({ stages: await daemon.listWorkflowStages(c.req.param("runId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/workflow-runs/:runId/tasks", async (c) => {
    try {
      return c.json({ tasks: await daemon.listWorkflowTasks(c.req.param("runId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/artifacts/:artifactId", async (c) => {
    try {
      return c.json({ artifact: await daemon.getWorkflowArtifact(c.req.param("artifactId")) });
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
}
