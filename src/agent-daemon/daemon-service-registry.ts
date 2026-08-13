import type {
  ModelSmokeRequest,
  ModelSmokeResponse,
  PromptRequest,
  PromptStreamEvent,
  StartWorkflowRequest,
  WorkflowRun,
} from "@zuu/client";
import type { AuditService } from "./audit-service";
import {
  createDaemonApiServices,
  type DaemonApiServices,
} from "./daemon-api-services";
import {
  createDaemonCoreServices,
  type DaemonCoreServices,
} from "./daemon-core-services";

interface DaemonServiceRegistryCallbacks {
  prompt(request: PromptRequest): AsyncGenerator<PromptStreamEvent>;
  abortSession(sessionId: string): Promise<unknown>;
  deleteSession(sessionId: string): Promise<unknown>;
  startWorkflow(workflowId: string, request: StartWorkflowRequest): Promise<WorkflowRun>;
}

interface DaemonServiceRegistryOptions {
  audit?: AuditService;
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

  diagnostics() {
    return this.api.modelApiService.diagnostics();
  }

  listModels() {
    return this.api.modelApiService.listModels();
  }

  smokeModel(request: ModelSmokeRequest = {}): Promise<ModelSmokeResponse> {
    return this.api.modelApiService.smokeModel(request);
  }

  async dispose() {
    this.core.scheduleService.dispose();
    await this.core.sessionService.dispose();
    this.core.runService.clear();
  }
}
