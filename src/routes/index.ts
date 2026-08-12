import { registerActivityRoutes } from "./activity";
import { registerApprovalRoutes } from "./approvals";
import { registerCoreRoutes } from "./core";
import { registerPackageRoutes } from "./packages";
import { registerProjectRoutes } from "./projects";
import { registerSessionRoutes } from "./sessions";
import type { RouteDeps } from "./types";

export function registerV1Routes(deps: RouteDeps) {
  registerCoreRoutes(deps);
  registerPackageRoutes(deps);
  registerProjectRoutes(deps);
  registerSessionRoutes(deps);
  registerActivityRoutes(deps);
  registerApprovalRoutes(deps);
}
