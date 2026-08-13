import { jsonError, readJson, toStatus } from "../server";
import { parseStartWorkflow } from "../validation";
import type { RouteDeps } from "./types";

export function registerProjectWorkflowRoutes({ app, daemon }: RouteDeps) {
  app.get("/v1/projects/:projectId/workflows", async (c) => {
    try {
      return c.json(await daemon.api.workflowApiService.listWorkflows(c.req.param("projectId")));
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/projects/:projectId/workflows/:workflowId/runs", async (c) => {
    try {
      const body = parseStartWorkflow(await readJson(c.req, { optional: true }));
      return c.json({ run: await daemon.api.workflowApiService.startWorkflow(c.req.param("workflowId"), body, c.req.param("projectId")) }, 201);
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.get("/v1/projects/:projectId/workflow-runs", async (c) => {
    try {
      return c.json({ runs: await daemon.api.workflowApiService.listWorkflowRuns(c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/projects/:projectId/workflow-runs/:runId", async (c) => {
    try {
      return c.json({ run: await daemon.api.workflowApiService.getWorkflowRun(c.req.param("runId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/projects/:projectId/workflow-runs/:runId/stages", async (c) => {
    try {
      return c.json({ stages: await daemon.api.workflowApiService.listWorkflowStages(c.req.param("runId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/projects/:projectId/workflow-runs/:runId/tasks", async (c) => {
    try {
      return c.json({ tasks: await daemon.api.workflowApiService.listWorkflowTasks(c.req.param("runId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/projects/:projectId/artifacts/:artifactId", async (c) => {
    try {
      return c.json({ artifact: await daemon.api.workflowApiService.getWorkflowArtifact(c.req.param("artifactId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/projects/:projectId/workflow-runs/:runId/abort", async (c) => {
    try {
      return c.json({ run: await daemon.api.workflowApiService.abortWorkflowRun(c.req.param("runId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });
}
