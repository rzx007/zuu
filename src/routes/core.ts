import { jsonError, toStatus } from "../http";
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
}
