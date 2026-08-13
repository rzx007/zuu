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
  readonly agentDir: DaemonCoreServices["agentDir"];
  readonly activeRunBySessionId: DaemonCoreServices["activeRunBySessionId"];
  readonly approvalWaitBySessionId: DaemonCoreServices["approvalWaitBySessionId"];
  readonly eventBus: DaemonCoreServices["eventBus"];
  readonly startedAt: DaemonCoreServices["startedAt"];

  readonly approvalService: DaemonCoreServices["approvalService"];
  readonly modelService: DaemonCoreServices["modelService"];
  readonly projectService: DaemonCoreServices["projectService"];
  readonly runService: DaemonCoreServices["runService"];
  readonly packageService: DaemonCoreServices["packageService"];
  readonly workflowService: DaemonCoreServices["workflowService"];
  readonly sessionService: DaemonCoreServices["sessionService"];
  readonly promptService: DaemonCoreServices["promptService"];
  readonly scheduleService: DaemonCoreServices["scheduleService"];

  readonly approvalApiService: DaemonApiServices["approvalApiService"];
  readonly modelApiService: DaemonApiServices["modelApiService"];
  readonly packageApiService: DaemonApiServices["packageApiService"];
  readonly projectApiService: DaemonApiServices["projectApiService"];
  readonly runApiService: DaemonApiServices["runApiService"];
  readonly scheduleApiService: DaemonApiServices["scheduleApiService"];
  readonly sessionApiService: DaemonApiServices["sessionApiService"];
  readonly workflowApiService: DaemonApiServices["workflowApiService"];

  constructor(
    private readonly callbacks: DaemonServiceRegistryCallbacks,
    options: DaemonServiceRegistryOptions = {},
  ) {
    const coreServices = createDaemonCoreServices(this.callbacks);
    this.agentDir = coreServices.agentDir;
    this.activeRunBySessionId = coreServices.activeRunBySessionId;
    this.approvalWaitBySessionId = coreServices.approvalWaitBySessionId;
    this.eventBus = coreServices.eventBus;
    this.startedAt = coreServices.startedAt;
    this.approvalService = coreServices.approvalService;
    this.modelService = coreServices.modelService;
    this.projectService = coreServices.projectService;
    this.runService = coreServices.runService;
    this.packageService = coreServices.packageService;
    this.workflowService = coreServices.workflowService;
    this.sessionService = coreServices.sessionService;
    this.promptService = coreServices.promptService;
    this.scheduleService = coreServices.scheduleService;

    const apiServices = createDaemonApiServices({
      audit: options.audit,
      callbacks: this.callbacks,
      approvalService: this.approvalService,
      modelService: this.modelService,
      packageService: this.packageService,
      projectService: this.projectService,
      runService: this.runService,
      scheduleService: this.scheduleService,
      sessionService: this.sessionService,
      workflowService: this.workflowService,
    });
    this.approvalApiService = apiServices.approvalApiService;
    this.modelApiService = apiServices.modelApiService;
    this.packageApiService = apiServices.packageApiService;
    this.projectApiService = apiServices.projectApiService;
    this.runApiService = apiServices.runApiService;
    this.scheduleApiService = apiServices.scheduleApiService;
    this.sessionApiService = apiServices.sessionApiService;
    this.workflowApiService = apiServices.workflowApiService;
  }

  diagnostics() {
    return this.modelApiService.diagnostics();
  }

  listModels() {
    return this.modelApiService.listModels();
  }

  smokeModel(request: ModelSmokeRequest = {}): Promise<ModelSmokeResponse> {
    return this.modelApiService.smokeModel(request);
  }

  async dispose() {
    this.scheduleService.dispose();
    await this.sessionService.dispose();
    this.runService.clear();
  }
}
