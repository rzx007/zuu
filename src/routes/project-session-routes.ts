import { jsonError, readJson, toStatus } from "../server";
import { parseCreateSession, parseOpenSession, parseUpdateSession } from "../validation";
import type { RouteDeps } from "./types";

export function registerProjectSessionRoutes({ app, daemon }: RouteDeps) {
  app.get("/v1/projects/:projectId/sessions", (c) => {
    try {
      return c.json({ sessions: daemon.api.sessionApiService.listSessions(c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/projects/:projectId/sessions", async (c) => {
    try {
      const body = parseCreateSession(await readJson(c.req, { optional: true }));
      const session = await daemon.api.sessionApiService.createSession({ ...body, projectId: c.req.param("projectId") });
      return c.json({ session: daemon.api.sessionApiService.summarizeSession(session) }, 201);
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.get("/v1/projects/:projectId/sessions/:sessionId", (c) => {
    try {
      return c.json({ session: daemon.api.sessionApiService.getSession(c.req.param("sessionId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.patch("/v1/projects/:projectId/sessions/:sessionId", async (c) => {
    try {
      const body = parseUpdateSession(await readJson(c.req));
      return c.json({ session: daemon.api.sessionApiService.updateSession(c.req.param("sessionId"), body, c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.delete("/v1/projects/:projectId/sessions/:sessionId", async (c) => {
    try {
      return c.json({ session: await daemon.api.sessionApiService.deleteSession(c.req.param("sessionId"), c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/projects/:projectId/session-files", async (c) => {
    try {
      return c.json({ sessions: await daemon.api.sessionApiService.listStoredSessions(undefined, c.req.param("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/projects/:projectId/sessions/open", async (c) => {
    try {
      const body = parseOpenSession(await readJson(c.req));
      const session = await daemon.api.sessionApiService.openSession({ ...body, projectId: c.req.param("projectId") });
      return c.json({ session: daemon.api.sessionApiService.summarizeSession(session) }, 201);
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });
}
