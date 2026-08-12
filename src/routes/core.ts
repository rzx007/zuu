import { jsonError, toStatus } from "../http";
import { readJson } from "../http";
import { parseModelSmoke } from "../request-validation";
import type { RouteDeps } from "./types";

export function registerCoreRoutes({ app, audit, auth, daemon }: RouteDeps) {
  app.get("/v1/health", (c) => c.json({ ok: true }));

  app.get("/v1/audit-events", (c) => c.json({ events: audit.list(Number(c.req.query("limit") ?? 100)) }));

  app.get("/v1/auth/status", (c) => c.json({ auth: auth.status() }));

  app.post("/v1/auth/rotate", (c) => {
    try {
      const result = auth.rotate();
      audit.record({ action: "auth.rotate", target: result.status.source, details: { source: result.status.source } });
      return c.json(result);
    } catch (error) {
      audit.record({ action: "auth.rotate", outcome: "failure", details: { error: error instanceof Error ? error.message : String(error) } });
      return c.json(jsonError(error, 409), toStatus(error, 409));
    }
  });

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
