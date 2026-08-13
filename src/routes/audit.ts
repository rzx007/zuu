import type { AuditEventAction, AuditEventOutcome, AuthScope } from "@zuu/client";
import { ApiError, jsonError, toStatus } from "../server";
import type { RouteDeps } from "./types";

const AUDIT_ACTIONS = new Set([
  "api.read",
  "api.mutate",
  "auth.rotate",
  "auth.token_create",
  "auth.token_revoke",
  "approval.resolve",
  "package.add",
  "package.install",
  "package.update",
  "package.remove",
  "package.trust",
  "package.revoke_trust",
]);
const AUDIT_OUTCOMES = new Set(["success", "failure"]);
const AUTH_SCOPES = new Set(["admin", "read"]);

export function registerAuditRoutes({ app, audit }: RouteDeps) {
  app.get("/v1/audit-events", (c) => {
    try {
      const action = auditAction(c.req.query("action"));
      const outcome = auditOutcome(c.req.query("outcome"));
      const authScope = authScopeFilter(c.req.query("authScope"));
      const authActor = auditTextFilter(c.req.query("authActor"), "authActor");
      const authTokenId = auditTextFilter(c.req.query("authTokenId"), "authTokenId");
      const since = auditTimestamp(c.req.query("since"), "since");
      const until = auditTimestamp(c.req.query("until"), "until");
      return c.json({
        events: audit.list({
          limit: Number(c.req.query("limit") ?? 100),
          action,
          outcome,
          target: c.req.query("target"),
          authScope,
          authActor,
          authTokenId,
          since,
          until,
        }),
      });
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

function authScopeFilter(value: string | undefined): AuthScope | undefined {
  if (value === undefined) return undefined;
  if (!AUTH_SCOPES.has(value)) throw new ApiError("authScope is invalid", { status: 400, code: "validation_failed", details: { field: "authScope" } });
  return value as AuthScope;
}

function auditTimestamp(value: string | undefined, field: "since" | "until") {
  if (value === undefined) return undefined;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw new ApiError(`${field} is invalid`, { status: 400, code: "validation_failed", details: { field } });
  return new Date(timestamp).toISOString();
}

function auditTextFilter(value: string | undefined, field: "authActor" | "authTokenId") {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) {
    throw new ApiError(`${field} is invalid`, { status: 400, code: "validation_failed", details: { field } });
  }
  return trimmed;
}
