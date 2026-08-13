import { buildHealth } from "../agent-daemon/core/health";
import type { RouteDeps } from "./types";

export function registerCoreRoutes({ app }: RouteDeps) {
  app.get("/v1/health", (c) => c.json(buildHealth()));
}
