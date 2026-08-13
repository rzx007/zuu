import { jsonError, readJson, toStatus } from "../http";
import { parseCreateSession, parseOpenSession, parseUpdateSession } from "../session-request-validation";
import type { RouteDeps } from "./types";

export function registerProjectSessionRoutes({ app, daemon }: RouteDeps) {
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
      return c.json(jsonError(error, 400), toStatus(error, 400));
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
}
