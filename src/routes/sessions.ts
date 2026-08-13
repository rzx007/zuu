import type { PromptRequest } from "@zuu/client";
import { jsonError, readJson, toStatus } from "../http";
import {
  parseCompact,
  parseCreateSession,
  parseForkSession,
  parseImportSession,
  parseNewSession,
  parseOpenSession,
  parsePrompt,
  parseSwitchSession,
  parseUpdateSession,
} from "../request-validation";
import { streamPromptResponse } from "./prompt-stream";
import type { RouteDeps } from "./types";

export function registerSessionRoutes({ app, daemon }: RouteDeps) {
  app.get("/v1/sessions", (c) => {
    try {
      return c.json({ sessions: daemon.listSessions(c.req.query("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/session-files", async (c) => {
    try {
      return c.json({ sessions: await daemon.listStoredSessions(c.req.query("cwd"), c.req.query("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 500), toStatus(error, 500));
    }
  });

  app.get("/v1/sessions/:sessionId", (c) => {
    try {
      return c.json({ session: daemon.getSession(c.req.param("sessionId"), c.req.query("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.patch("/v1/sessions/:sessionId", async (c) => {
    try {
      const body = parseUpdateSession(await readJson(c.req));
      return c.json({ session: daemon.updateSession(c.req.param("sessionId"), body, c.req.query("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.delete("/v1/sessions/:sessionId", async (c) => {
    try {
      return c.json({ session: await daemon.deleteSession(c.req.param("sessionId"), c.req.query("projectId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.get("/v1/sessions/:sessionId/tree", (c) => {
    try {
      return c.json({ tree: daemon.summarizeSessionTree(c.req.param("sessionId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/sessions", async (c) => {
    try {
      const body = parseCreateSession(await readJson(c.req, { optional: true }));
      const session = await daemon.createSession(body);
      return c.json({ session: daemon.summarizeSession(session) }, 201);
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.post("/v1/sessions/open", async (c) => {
    try {
      const body = parseOpenSession(await readJson(c.req));
      const session = await daemon.openSession(body);
      return c.json({ session: daemon.summarizeSession(session) }, 201);
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.post("/v1/prompt", async (c) => {
    let request: PromptRequest;
    try {
      request = parsePrompt(await readJson(c.req));
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }

    return streamPromptResponse(c, daemon, request);
  });

  app.post("/v1/sessions/:sessionId/prompts", async (c) => {
    let request: PromptRequest;
    try {
      request = { ...parsePrompt(await readJson(c.req)), sessionId: c.req.param("sessionId") };
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }

    return streamPromptResponse(c, daemon, request);
  });

  app.post("/v1/sessions/:sessionId/steer", async (c) => {
    let request: PromptRequest;
    try {
      request = {
        ...parsePrompt(await readJson(c.req)),
        sessionId: c.req.param("sessionId"),
        streamingBehavior: "steer",
      };
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }

    return streamPromptResponse(c, daemon, request);
  });

  app.post("/v1/sessions/:sessionId/follow-ups", async (c) => {
    let request: PromptRequest;
    try {
      request = {
        ...parsePrompt(await readJson(c.req)),
        sessionId: c.req.param("sessionId"),
        streamingBehavior: "followUp",
      };
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }

    return streamPromptResponse(c, daemon, request);
  });

  app.post("/v1/sessions/:sessionId/abort", async (c) => {
    try {
      const session = await daemon.abort(c.req.param("sessionId"));
      return c.json({ session });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/sessions/:sessionId/compact", async (c) => {
    try {
      const body = parseCompact(await readJson(c.req, { optional: true }));
      const session = await daemon.compact(c.req.param("sessionId"), body.instructions);
      return c.json({ session });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/sessions/:sessionId/new", async (c) => {
    try {
      const body = parseNewSession(await readJson(c.req, { optional: true }));
      return c.json(await daemon.newSession(c.req.param("sessionId"), body));
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.post("/v1/sessions/:sessionId/switch", async (c) => {
    try {
      const body = parseSwitchSession(await readJson(c.req));
      return c.json(await daemon.switchSession(c.req.param("sessionId"), body));
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.post("/v1/sessions/:sessionId/fork", async (c) => {
    try {
      const body = parseForkSession(await readJson(c.req));
      return c.json(await daemon.forkSession(c.req.param("sessionId"), body));
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.post("/v1/sessions/:sessionId/import", async (c) => {
    try {
      const body = parseImportSession(await readJson(c.req));
      return c.json(await daemon.importSession(c.req.param("sessionId"), body));
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });
}
