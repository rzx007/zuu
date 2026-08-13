import type { Hono } from "hono";
import type { AuditService } from "../agent-daemon/audit-service";
import type { AuthService } from "../agent-daemon/auth-service";
import type { DaemonServiceRegistry } from "../agent-daemon/daemon-service-registry";

export interface RouteDeps {
  app: Hono;
  audit: AuditService;
  auth: AuthService;
  daemon: DaemonServiceRegistry;
}
