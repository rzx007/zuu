import {
  createEventBus,
  type EventBusController,
} from "@earendil-works/pi-coding-agent";
import type {
  ModelSmokeRequest,
  ModelSmokeResponse,
  PromptRequest,
  PromptStreamEvent,
  StartWorkflowRequest,
  WorkflowRun,
} from "@zuu/client";
import type { AuditService } from "./audit-service";
import { ApprovalService } from "./approval-service";
import {
  createDaemonApiServices,
  type DaemonApiServices,
} from "./daemon-api-services";
import {
  getApprovalStorePath,
  getPackageOperationStorePath,
  getPackageTrustStorePath,
  getProjectStorePath,
  getRunEventStorePath,
  getRunStorePath,
  getScheduleLeaseStorePath,
  getScheduleStorePath,
  getZuuAgentDir,
} from "./environment";
import { ModelService } from "./model-service";
import { PackageService } from "./packages";
import { ProjectService } from "./project-service";
import { PromptService } from "./prompt-service";
import { RunService } from "./run-service";
import { createDaemonScheduleExecutor, launchPromptAsRun } from "./schedule-executor";
import { ScheduleService } from "./schedule-service";
import { SessionService } from "./session-service";
import { WorkflowService } from "./workflow-service";

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
  readonly agentDir = getZuuAgentDir();
  readonly activeRunBySessionId = new Map<string, string>();
  readonly approvalWaitBySessionId = new Map<string, boolean>();
  readonly eventBus: EventBusController = createEventBus();
  readonly startedAt = new Date().toISOString();

  readonly approvalService = new ApprovalService(getApprovalStorePath(this.agentDir));
  readonly modelService = new ModelService();
  readonly projectService = new ProjectService(getProjectStorePath(this.agentDir), this.agentDir);
  readonly runService = new RunService(getRunStorePath(this.agentDir), getRunEventStorePath(this.agentDir));
  readonly packageService = new PackageService(
    process.cwd(),
    this.agentDir,
    getPackageOperationStorePath(this.agentDir),
    getPackageTrustStorePath(this.agentDir),
  );
  readonly workflowService: WorkflowService;
  readonly sessionService: SessionService;
  readonly promptService: PromptService;
  readonly scheduleService: ScheduleService;

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
    this.workflowService = new WorkflowService({
      agentDir: this.agentDir,
      packageService: this.packageService,
      projects: this.projectService,
      launchPrompt: (request) => launchPromptAsRun((promptRequest) => this.callbacks.prompt(promptRequest), request),
    });
    this.sessionService = new SessionService({
      agentDir: this.agentDir,
      projects: this.projectService,
      packageService: this.packageService,
      modelRuntimePromise: this.modelService.getRuntimePromise(),
      approvals: this.approvalService,
      activeRunBySessionId: this.activeRunBySessionId,
      approvalWaitBySessionId: this.approvalWaitBySessionId,
      eventBus: this.eventBus,
      startedAt: this.startedAt,
    });
    this.promptService = new PromptService({
      sessions: this.sessionService,
      runs: this.runService,
      eventBus: this.eventBus,
      activeRunBySessionId: this.activeRunBySessionId,
      approvalWaitBySessionId: this.approvalWaitBySessionId,
    });
    this.scheduleService = new ScheduleService({
      path: getScheduleStorePath(this.agentDir),
      leasePath: getScheduleLeaseStorePath(this.agentDir),
      projects: this.projectService,
      executor: createDaemonScheduleExecutor({
        prompt: (request) => this.callbacks.prompt(request),
        startWorkflow: (workflowId, request) => this.callbacks.startWorkflow(workflowId, request),
      }),
    });

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
