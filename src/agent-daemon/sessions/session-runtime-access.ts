import { notFound } from "../../http";
import type { ProjectService } from "../projects/project-service";
import type { SessionRuntimeRegistry } from "./session-registry";
import type { ManagedRuntime } from "./session-runtime";

export function getManagedRuntimeForProject(
  runtimes: SessionRuntimeRegistry,
  projects: ProjectService,
  sessionId: string,
  projectId?: string,
) {
  const managed = runtimes.get(sessionId);
  if (projectId) assertManagedRuntimeProject(projects, managed, sessionId, projectId);
  return managed;
}

export function assertManagedRuntimeProject(
  projects: ProjectService,
  managed: ManagedRuntime,
  sessionId: string,
  projectId: string,
) {
  projects.get(projectId);
  if (managed.projectId !== projectId) {
    notFound(`Unknown session: ${sessionId}`, { sessionId, projectId });
  }
}
