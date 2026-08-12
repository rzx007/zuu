import { registerActivityRoutes } from "./activity";
import { registerApprovalRoutes } from "./approvals";
import { registerCoreRoutes } from "./core";
import { registerPackageRoutes } from "./packages";
import { registerProjectScheduleRoutes } from "./project-schedules";
import { registerProjectWorkflowRoutes } from "./project-workflows";
import { registerProjectRoutes } from "./projects";
import { registerScheduleRoutes } from "./schedules";
import { registerSessionRoutes } from "./sessions";
import { registerWorkflowRoutes } from "./workflows";
import type { RouteDeps } from "./types";

export function registerV1Routes(deps: RouteDeps) {
  registerCoreRoutes(deps);
  registerPackageRoutes(deps);
  registerProjectRoutes(deps);
  registerProjectWorkflowRoutes(deps);
  registerProjectScheduleRoutes(deps);
  registerSessionRoutes(deps);
  registerActivityRoutes(deps);
  registerWorkflowRoutes(deps);
  registerScheduleRoutes(deps);
  registerApprovalRoutes(deps);
}
