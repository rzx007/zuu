import { jsonError, readJson, toStatus } from "../http";
import { parseModelSmoke } from "../prompt-request-validation";
import type { RouteDeps } from "./types";

export function registerModelRoutes({ app, daemon }: RouteDeps) {
  app.get("/v1/diagnostics", async (c) => {
    try {
      return c.json(await daemon.api.modelApiService.diagnostics());
    } catch (error) {
      return c.json(jsonError(error, 500), toStatus(error, 500));
    }
  });

  app.get("/v1/models", async (c) => {
    try {
      return c.json(await daemon.api.modelApiService.listModels());
    } catch (error) {
      return c.json(jsonError(error, 500), toStatus(error, 500));
    }
  });

  app.post("/v1/models/smoke", async (c) => {
    try {
      const body = parseModelSmoke(await readJson(c.req, { optional: true }));
      return c.json(await daemon.api.modelApiService.smokeModel(body));
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });
}
