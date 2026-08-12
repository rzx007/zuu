import type { Hono } from "hono";
import type { ZuuDaemon } from "../agent-daemon";

export interface RouteDeps {
  app: Hono;
  daemon: ZuuDaemon;
}
