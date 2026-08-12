import type { MiddlewareHandler } from "hono";
import type { AuditService } from "./audit-service";

const AUDITED_METHODS = new Set(["POST", "PATCH", "DELETE"]);

export function createAuditMiddleware(audit: AuditService): MiddlewareHandler {
  return async (c, next) => {
    if (!AUDITED_METHODS.has(c.req.method)) {
      await next();
      return;
    }

    await next();
    audit.record({
      action: "api.mutate",
      target: `${c.req.method} ${c.req.path}`,
      outcome: c.res.status >= 400 ? "failure" : "success",
      details: {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
      },
    });
  };
}
