import type {
  EventBusController,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { ApiError } from "../../http";
import type { ApprovalRegistry } from "../approvals/approval-service";
import { assertAllowedPath } from "../core/environment";
import type { PackageService } from "../packages/packages";
import type { ProjectService } from "../projects/project-service";
import type { SessionRuntimeRegistry } from "./session-registry";
import { createManagedRuntime, type CreateSessionOptions } from "./session-runtime";

export interface CreateSessionRuntimeDeps {
  agentDir: string;
  projects: ProjectService;
  packageService: PackageService;
  modelRuntimePromise: Promise<ModelRuntime>;
  approvals: ApprovalRegistry;
  activeRunBySessionId: Map<string, string>;
  approvalWaitBySessionId: Map<string, boolean>;
  eventBus: EventBusController;
  startedAt: string;
  runtimes: SessionRuntimeRegistry;
}

export async function createSessionRuntime(options: CreateSessionOptions, deps: CreateSessionRuntimeDeps) {
  if (options.sessionFile) {
    assertAllowedPath(options.sessionFile, "sessionFile");
    const existing = deps.runtimes.findBySessionFile(options.sessionFile);
    if (existing) {
      if (options.projectId && existing.projectId !== options.projectId) {
        throw new ApiError(`Session file is already open in project ${existing.projectId}`, {
          status: 409,
          code: "session_file_busy",
          details: { sessionFile: options.sessionFile, projectId: existing.projectId },
        });
      }
      return existing.runtime.session;
    }
  }

  const project = deps.projects.resolveProject(options);
  const managed = await createManagedRuntime(
    {
      agentDir: deps.agentDir,
      projectId: project.id,
      cwd: project.cwd,
      packageService: deps.packageService,
      modelRuntimePromise: deps.modelRuntimePromise,
      approvals: deps.approvals,
      activeRunBySessionId: deps.activeRunBySessionId,
      approvalWaitBySessionId: deps.approvalWaitBySessionId,
      eventBus: deps.eventBus,
      startedAt: deps.startedAt,
      getSessionCount: () => deps.runtimes.size,
    },
    options,
  );
  deps.runtimes.add(managed);
  return managed.runtime.session;
}
