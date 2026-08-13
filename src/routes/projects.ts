import { jsonError, readJson, toStatus } from "../server";
import { parseCreateProject, parseUpdateProject } from "../validation";
import { registerProjectRunRoutes } from "./project-run-routes";
import { registerProjectSessionRoutes } from "./project-session-routes";
import type { RouteDeps } from "./types";

export function registerProjectRoutes(deps: RouteDeps) {
  const { app, daemon } = deps;
  app.get("/v1/projects", (c) => c.json({ projects: daemon.api.projectApiService.listProjects() }));

  app.post("/v1/projects", async (c) => {
    try {
      const body = parseCreateProject(await readJson(c.req));
      return c.json({ project: daemon.api.projectApiService.createProject(body) }, 201);
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.get("/v1/projects/:projectId", (c) => {
    try {
      return c.json({ project: daemon.api.projectApiService.getProject(c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.patch("/v1/projects/:projectId", async (c) => {
    try {
      const body = parseUpdateProject(await readJson(c.req));
      return c.json({ project: daemon.api.projectApiService.updateProject(c.req.param("projectId"), body) });
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.delete("/v1/projects/:projectId", (c) => {
    try {
      return c.json({ project: daemon.api.projectApiService.deleteProject(c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  registerProjectSessionRoutes(deps);
  registerProjectRunRoutes(deps);
}
