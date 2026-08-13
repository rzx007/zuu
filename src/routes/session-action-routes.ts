import { jsonError, readJson, toStatus } from "../server";
import {
  parseCompact,
  parseForkSession,
  parseImportSession,
  parseNewSession,
  parseSwitchSession,
} from "../validation";
import type { RouteDeps } from "./types";

export function registerSessionActionRoutes({ app, daemon }: RouteDeps) {
  app.post("/v1/sessions/:sessionId/abort", async (c) => {
    try {
      const session = await daemon.api.sessionApiService.abortSession(c.req.param("sessionId"));
      return c.json({ session });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/sessions/:sessionId/compact", async (c) => {
    try {
      const body = parseCompact(await readJson(c.req, { optional: true }));
      const session = await daemon.api.sessionApiService.compactSession(c.req.param("sessionId"), body.instructions);
      return c.json({ session });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/sessions/:sessionId/new", async (c) => {
    try {
      const body = parseNewSession(await readJson(c.req, { optional: true }));
      return c.json(await daemon.api.sessionApiService.newSession(c.req.param("sessionId"), body));
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.post("/v1/sessions/:sessionId/switch", async (c) => {
    try {
      const body = parseSwitchSession(await readJson(c.req));
      return c.json(await daemon.api.sessionApiService.switchSession(c.req.param("sessionId"), body));
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.post("/v1/sessions/:sessionId/fork", async (c) => {
    try {
      const body = parseForkSession(await readJson(c.req));
      return c.json(await daemon.api.sessionApiService.forkSession(c.req.param("sessionId"), body));
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.post("/v1/sessions/:sessionId/import", async (c) => {
    try {
      const body = parseImportSession(await readJson(c.req));
      return c.json(await daemon.api.sessionApiService.importSession(c.req.param("sessionId"), body));
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });
}
