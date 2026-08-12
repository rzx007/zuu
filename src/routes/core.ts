import type { AuditEventAction, AuditEventOutcome } from "@zuu/client";
import { buildHealth } from "../agent-daemon/health";
import { ApiError, jsonError, toStatus } from "../http";
import { readJson } from "../http";
import { parseModelSmoke } from "../request-validation";
import type { RouteDeps } from "./types";

const AUDIT_ACTIONS = new Set([
  "api.mutate",
  "auth.rotate",
  "approval.resolve",
  "package.add",
  "package.install",
  "package.update",
  "package.remove",
  "package.trust",
  "package.revoke_trust",
]);
const AUDIT_OUTCOMES = new Set(["success", "failure"]);

export function registerCoreRoutes({ app, audit, auth, daemon }: RouteDeps) {
  app.get("/v1/health", (c) => c.json(buildHealth()));

  app.get("/v1/audit-events", (c) => {
    try {
      const action = auditAction(c.req.query("action"));
      const outcome = auditOutcome(c.req.query("outcome"));
      return c.json({
        events: audit.list({
          limit: Number(c.req.query("limit") ?? 100),
          action,
          outcome,
          target: c.req.query("target"),
        }),
      });
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

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

function auditAction(value: string | undefined): AuditEventAction | undefined {
  if (value === undefined) return undefined;
  if (!AUDIT_ACTIONS.has(value)) throw new ApiError("action is invalid", { status: 400, code: "validation_failed", details: { field: "action" } });
  return value as AuditEventAction;
}

function auditOutcome(value: string | undefined): AuditEventOutcome | undefined {
  if (value === undefined) return undefined;
  if (!AUDIT_OUTCOMES.has(value)) throw new ApiError("outcome is invalid", { status: 400, code: "validation_failed", details: { field: "outcome" } });
  return value as AuditEventOutcome;
}
