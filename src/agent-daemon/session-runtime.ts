import {
  createAgentSessionRuntime,
  type AgentSessionRuntime,
} from "@earendil-works/pi-coding-agent";
import type { CreateSessionRequest } from "@zuu/client";
import { getSessionDir } from "./agent-paths";
import { assertAllowedPath } from "./environment";
import { createManagedSessionManager } from "./session-manager-factory";
import { createZuuRuntimeFactory, type RuntimeFactoryDeps } from "./session-runtime-factory";

export interface ManagedRuntime {
  runtime: AgentSessionRuntime;
  projectId: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
}

export type CreateSessionOptions = CreateSessionRequest;

export interface CreateManagedRuntimeDeps extends RuntimeFactoryDeps {
  agentDir: string;
  projectId: string;
  cwd: string;
}

export async function createManagedRuntime(
  deps: CreateManagedRuntimeDeps,
  options: CreateSessionOptions,
): Promise<ManagedRuntime> {
  assertAllowedPath(deps.cwd, "cwd");
  const sessionDir = getSessionDir(deps.agentDir);
  const sessionManager = createManagedSessionManager(options, deps.cwd, sessionDir);
  const runtimeCwd = sessionManager.getCwd();
  const runtimeFactory = createZuuRuntimeFactory(deps, options);
  const runtime = await createAgentSessionRuntime(
    runtimeFactory,
    {
      cwd: runtimeCwd,
      agentDir: deps.agentDir,
      sessionManager,
    },
  );

  if (options.name) runtime.session.setSessionName(options.name);

  const now = new Date().toISOString();
  return {
    runtime,
    projectId: deps.projectId,
    cwd: runtime.cwd,
    createdAt: now,
    updatedAt: now,
  };
}

export function bindManagedRuntime(runtimes: Map<string, ManagedRuntime>, managed: ManagedRuntime) {
  managed.runtime.setRebindSession(async (session) => {
    for (const [sessionId, item] of runtimes) {
      if (item === managed && sessionId !== session.sessionId) {
        runtimes.delete(sessionId);
      }
    }
    managed.cwd = managed.runtime.cwd;
    managed.updatedAt = new Date().toISOString();
    runtimes.set(session.sessionId, managed);
  });
}
