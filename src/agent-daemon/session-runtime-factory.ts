import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  type CreateAgentSessionRuntimeFactory,
  type DefaultResourceLoader,
  type EventBusController,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { createApprovalExtension } from "./approval-policy";
import type { ApprovalRegistry } from "./approval-service";
import { DEFAULT_READ_ONLY_TOOLS } from "./environment";
import type { PackageService } from "./packages";
import type { CreateSessionOptions } from "./session-runtime";
import { createStatusTool } from "./status-tool";

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
