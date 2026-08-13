import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getSessionDir } from "./agent-paths";
import { assertAllowedPath } from "./environment";
import type { ProjectService } from "./project-service";
import type { SessionRuntimeRegistry } from "./session-registry";
import { summarizeStoredSession } from "./session-summary";

export async function listStoredSessionSummaries(options: {
  agentDir: string;
  projects: ProjectService;
  runtimes: SessionRuntimeRegistry;
  cwd?: string;
  projectId?: string;
}) {
  const projectCwd = options.projectId ? options.projects.get(options.projectId).cwd : undefined;
  const targetCwd = options.cwd ?? projectCwd;
  if (targetCwd) assertAllowedPath(targetCwd, "cwd");

  const sessionDir = getSessionDir(options.agentDir);
  const sessions = targetCwd ? await SessionManager.list(targetCwd, sessionDir) : await SessionManager.listAll(sessionDir);
  return sessions
    .map((session) =>
      summarizeStoredSession(session, {
        projectId: options.projectId,
        isActive: options.runtimes.isSessionFileActive(session.path),
      }),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
