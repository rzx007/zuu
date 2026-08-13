import type { MiddlewareHandler } from "hono";
import { jsonError } from "../../server";
import type { AuthScope } from "./auth-service";
import type { AuthService } from "./auth-service";

export function createAuthMiddleware(auth: AuthService): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path === "/v1/health") {
      await next();
      return;
    }

    const decision = auth.authorize(c.req.header("authorization"), requiredAuthScope(c.req.method));
    if (!decision.authorized) {
      if (decision.reason === "forbidden") {
        return c.json(jsonError("Forbidden", 403), 403);
      }
      return c.json(jsonError("Unauthorized", 401), 401);
    }

    await next();
  };
}

function requiredAuthScope(method: string): AuthScope {
  return method === "GET" ? "read" : "admin";
}
