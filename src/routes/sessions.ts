import { jsonError, readJson, toStatus } from "../server";
import { parseCreateSession, parseOpenSession, parseUpdateSession } from "../validation";
import { registerSessionActionRoutes } from "./session-action-routes";
import { registerSessionPromptRoutes } from "./session-prompt-routes";
import type { RouteDeps } from "./types";

export function registerSessionRoutes(deps: RouteDeps) {
  const { app, daemon } = deps;
  app.get("/v1/sessions", (c) => {
    try {
      return c.json({ sessions: daemon.api.sessionApiService.listSessions(c.req.query("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/session-files", async (c) => {
    try {
      return c.json({ sessions: await daemon.api.sessionApiService.listStoredSessions(c.req.query("cwd"), c.req.query("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 500), toStatus(error, 500));
    }
  });

  app.get("/v1/sessions/:sessionId", (c) => {
    try {
      return c.json({ session: daemon.api.sessionApiService.getSession(c.req.param("sessionId"), c.req.query("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.patch("/v1/sessions/:sessionId", async (c) => {
    try {
      const body = parseUpdateSession(await readJson(c.req));
      return c.json({ session: daemon.api.sessionApiService.updateSession(c.req.param("sessionId"), body, c.req.query("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.delete("/v1/sessions/:sessionId", async (c) => {
    try {
      return c.json({ session: await daemon.api.sessionApiService.deleteSession(c.req.param("sessionId"), c.req.query("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/sessions/:sessionId/tree", (c) => {
    try {
      return c.json({ tree: daemon.api.sessionApiService.summarizeSessionTree(c.req.param("sessionId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/sessions", async (c) => {
    try {
      const body = parseCreateSession(await readJson(c.req, { optional: true }));
      const session = await daemon.api.sessionApiService.createSession(body);
      return c.json({ session: daemon.api.sessionApiService.summarizeSession(session) }, 201);
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.post("/v1/sessions/open", async (c) => {
    try {
      const body = parseOpenSession(await readJson(c.req));
      const session = await daemon.api.sessionApiService.openSession(body);
      return c.json({ session: daemon.api.sessionApiService.summarizeSession(session) }, 201);
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  registerSessionPromptRoutes(deps);
  registerSessionActionRoutes(deps);
}
