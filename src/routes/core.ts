import { jsonError, toStatus } from "../http";
import { readJson } from "../http";
import { parseModelSmoke } from "../request-validation";
import type { RouteDeps } from "./types";

export function registerCoreRoutes({ app, daemon }: RouteDeps) {
  app.get("/v1/health", (c) => c.json({ ok: true }));

  app.get("/v1/diagnostics", async (c) => {
    try {
      return c.json(await daemon.diagnostics());
    } catch (error) {
      return c.json(jsonError(error, 500), toStatus(error, 500));
    }
  });

  app.get("/v1/models", async (c) => {
    try {
      return c.json(await daemon.listModels());
    } catch (error) {
      return c.json(jsonError(error, 500), toStatus(error, 500));
    }
  });

  app.post("/v1/models/smoke", async (c) => {
    try {
      const body = parseModelSmoke(await readJson(c.req, { optional: true }));
      return c.json(await daemon.smokeModel(body));
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });
}
