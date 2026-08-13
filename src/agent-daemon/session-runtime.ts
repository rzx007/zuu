import {
  createAgentSessionRuntime,
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  type DefaultResourceLoader,
  type EventBusController,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { CreateSessionRequest } from "@zuu/client";
import { createApprovalExtension } from "./approval-policy";
import type { ApprovalRegistry } from "./approval-service";
import { getSessionDir } from "./agent-paths";
import { assertAllowedPath, DEFAULT_READ_ONLY_TOOLS } from "./environment";
import type { PackageService } from "./packages";
import { createStatusTool } from "./status-tool";

export interface ManagedRuntime {
  runtime: AgentSessionRuntime;
  projectId: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
}

export type CreateSessionOptions = CreateSessionRequest;

export interface RuntimeFactoryDeps {
  packageService: PackageService;
  modelRuntimePromise: Promise<ModelRuntime>;
  approvals: ApprovalRegistry;
  activeRunBySessionId: Map<string, string>;
  approvalWaitBySessionId: Map<string, boolean>;
  eventBus: EventBusController;
  startedAt: string;
  getSessionCount: () => number;
}

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

export function createZuuRuntimeFactory(
  deps: RuntimeFactoryDeps,
  options: CreateSessionOptions,
): CreateAgentSessionRuntimeFactory {
  return async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
    const settingsManager = deps.packageService.createTrustedSettingsManager(cwd);
    const modelRuntime = await deps.modelRuntimePromise;
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      modelRuntime,
      settingsManager,
      resourceLoaderOptions: {
        eventBus: deps.eventBus,
        extensionFactories: [
          createApprovalExtension({
            approvals: deps.approvals,
            getActiveRunId: (sessionId) => deps.activeRunBySessionId.get(sessionId),
            canWaitForApproval: (sessionId) => deps.approvalWaitBySessionId.get(sessionId) ?? true,
          }),
        ],
        appendSystemPrompt: [
          "You are running inside Zuu, a small daemon-hosted Pi SDK agent app.",
          "Be explicit about files changed, commands run, and assumptions.",
        ],
      },
    });
    const model = options.model ? modelRuntime.getModel(options.model.provider, options.model.id) : undefined;
    const statusTool = createStatusTool({
      cwd,
      startedAt: deps.startedAt,
      getSessionCount: deps.getSessionCount,
      settingsManager,
      resourceLoader: services.resourceLoader as DefaultResourceLoader,
    });
    const result = await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
      model,
      thinkingLevel: options.thinkingLevel,
      customTools: [statusTool],
      tools: options.tools ?? DEFAULT_READ_ONLY_TOOLS,
    });

    return {
      ...result,
      services,
      diagnostics: services.diagnostics,
    };
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

export function createManagedSessionManager(options: CreateSessionOptions, cwd: string, sessionDir: string) {
  assertAllowedPath(cwd, "cwd");
  if (options.sessionFile) {
    assertAllowedPath(options.sessionFile, "sessionFile");
    return SessionManager.open(options.sessionFile, sessionDir, cwd);
  }

  if (options.continueRecent) {
    return SessionManager.continueRecent(cwd, sessionDir);
  }

  return options.persist === false ? SessionManager.inMemory(cwd) : SessionManager.create(cwd, sessionDir);
}
