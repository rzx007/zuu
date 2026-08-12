import type { AuthCreateTokenRequest } from "@zuu/client";
import { ApiError, jsonError, readJson, toStatus } from "../http";
import type { RouteDeps } from "./types";

export function registerAuthRoutes({ app, audit, auth }: RouteDeps) {
  app.get("/v1/auth/status", (c) => c.json({ auth: auth.status() }));

  app.post("/v1/auth/rotate", (c) => {
    try {
      const result = auth.rotate();
      audit.record({ action: "auth.rotate", target: result.status.source, details: { source: result.status.source } });
      return c.json({ auth: result.status, apiToken: result.apiToken, readApiToken: result.readApiToken });
    } catch (error) {
      audit.record({ action: "auth.rotate", outcome: "failure", details: { error: error instanceof Error ? error.message : String(error) } });
      return c.json(jsonError(error, 409), toStatus(error, 409));
    }
  });

  app.post("/v1/auth/tokens", async (c) => {
    try {
      const result = auth.createToken(parseAuthCreateToken(await readJson(c.req)));
      audit.record({
        action: "auth.token_create",
        target: result.token.id,
        details: { actor: result.token.actor, scope: result.token.scope },
      });
      return c.json({ auth: result.status, token: result.token, apiToken: result.apiToken }, 201);
    } catch (error) {
      audit.record({
        action: "auth.token_create",
        outcome: "failure",
        details: { error: error instanceof Error ? error.message : String(error) },
      });
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.delete("/v1/auth/tokens/:tokenId", (c) => {
    try {
      const result = auth.revokeToken(c.req.param("tokenId"));
      audit.record({
        action: "auth.token_revoke",
        target: result.revoked.id,
        details: { actor: result.revoked.actor, scope: result.revoked.scope },
      });
      return c.json({ auth: result.status, revoked: result.revoked });
    } catch (error) {
      audit.record({
        action: "auth.token_revoke",
        outcome: "failure",
        target: c.req.param("tokenId"),
        details: { error: error instanceof Error ? error.message : String(error) },
      });
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });
}

function parseAuthCreateToken(value: unknown): AuthCreateTokenRequest {
  if (!value || typeof value !== "object") {
    throw new ApiError("request body is required", { status: 400, code: "validation_failed" });
  }
  const body = value as Record<string, unknown>;
  if (body.scope !== "admin" && body.scope !== "read") {
    throw new ApiError("scope must be admin or read", { status: 400, code: "validation_failed", details: { field: "scope" } });
  }
  if (body.actor !== undefined && typeof body.actor !== "string") {
    throw new ApiError("actor must be a string", { status: 400, code: "validation_failed", details: { field: "actor" } });
  }
  if (body.expiresAt !== undefined && typeof body.expiresAt !== "string") {
    throw new ApiError("expiresAt must be a string", { status: 400, code: "validation_failed", details: { field: "expiresAt" } });
  }
  return { scope: body.scope, actor: body.actor, expiresAt: body.expiresAt };
}
