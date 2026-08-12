import type { Hono } from "hono";
import type { AuthService } from "../agent-daemon/auth-service";
import type { ZuuDaemon } from "../agent-daemon";

export interface RouteDeps {
  app: Hono;
  auth: AuthService;
  daemon: ZuuDaemon;
}
