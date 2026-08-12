import type { MiddlewareHandler } from "hono";
import type { AuditEventAction } from "@zuu/client";
import type { AuthContext } from "./auth-service";
import type { AuditService } from "./audit-service";

const MUTATING_METHODS = new Set(["POST", "PATCH", "DELETE"]);
const IGNORED_READ_PATHS = new Set(["/v1/health"]);

interface AuditMiddlewareOptions {
  resolveAuthContext?: (authorization: string | undefined) => AuthContext | undefined;
}

export function createAuditMiddleware(audit: AuditService, options: AuditMiddlewareOptions = {}): MiddlewareHandler {
  return async (c, next) => {
    const action = auditActionForRequest(c.req.method, c.req.path);
    if (!action) {
      await next();
      return;
    }

    await next();
    const authContext = options.resolveAuthContext?.(c.req.header("authorization"));
    audit.record({
      action,
      target: `${c.req.method} ${c.req.path}`,
      outcome: c.res.status >= 400 ? "failure" : "success",
      details: {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ...(authContext
          ? {
              authScope: authContext.scope,
              authActor: authContext.actor,
              authTokenId: authContext.tokenId,
            }
          : {}),
      },
    });
  };
}

function auditActionForRequest(method: string, path: string): AuditEventAction | undefined {
  if (MUTATING_METHODS.has(method)) return "api.mutate";
  if (method !== "GET") return undefined;
  if (IGNORED_READ_PATHS.has(path) || path.startsWith("/v1/events")) return undefined;
  return "api.read";
}
