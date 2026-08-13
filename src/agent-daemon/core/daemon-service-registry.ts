import type {
  PromptRequest,
  PromptStreamEvent,
  StartWorkflowRequest,
  WorkflowRun,
} from "@zuu/client";
import type { AuditService } from "../audit/audit-service";
import {
  createDaemonApiServices,
  type DaemonApiServices,
} from "../api/daemon-api-services";
import {
  createDaemonCoreServices,
  type DaemonCoreServices,
} from "./daemon-core-services";

interface DaemonServiceRegistryCallbacks {
  prompt(request: PromptRequest): AsyncGenerator<PromptStreamEvent>;
  abortRun(runId: string, projectId?: string): Promise<unknown>;
  abortSession(sessionId: string): Promise<unknown>;
  deleteSession(sessionId: string): Promise<unknown>;
  startWorkflow(workflowId: string, request: StartWorkflowRequest): Promise<WorkflowRun>;
}

export interface DaemonServiceRegistryOptions {
  audit?: AuditService;
}

export function createDaemonServiceRegistry(options: DaemonServiceRegistryOptions = {}) {
  let registry!: DaemonServiceRegistry;
  registry = new DaemonServiceRegistry({
    prompt: (request) => registry.core.promptService.prompt(request),
    abortRun: (runId, projectId) => registry.api.runApiService.abortRun(runId, projectId),
    abortSession: (sessionId) => registry.api.sessionApiService.abortSession(sessionId),
    deleteSession: (sessionId) => registry.api.sessionApiService.deleteSession(sessionId),
    startWorkflow: (workflowId, request) => registry.api.workflowApiService.startWorkflow(workflowId, request),
  }, options);
  return registry;
}

export class DaemonServiceRegistry {
  readonly core: DaemonCoreServices;
  readonly api: DaemonApiServices;

  constructor(
    private readonly callbacks: DaemonServiceRegistryCallbacks,
    options: DaemonServiceRegistryOptions = {},
  ) {
    this.core = createDaemonCoreServices(this.callbacks);

    this.api = createDaemonApiServices({
      audit: options.audit,
      callbacks: this.callbacks,
      approvalService: this.core.approvalService,
      modelService: this.core.modelService,
      packageService: this.core.packageService,
      projectService: this.core.projectService,
      runService: this.core.runService,
      scheduleService: this.core.scheduleService,
      sessionService: this.core.sessionService,
      workflowService: this.core.workflowService,
    });
  }

  async dispose() {
    this.core.scheduleService.dispose();
    await this.core.sessionService.dispose();
    this.core.runService.clear();
  }
}
