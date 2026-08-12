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
import { ApprovalApiService } from "./approval-api-service";
import { ApprovalService } from "./approval-service";
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
import { ModelApiService } from "./model-api-service";
import { ModelService } from "./model-service";
import { PackageApiService } from "./package-api-service";
import { PackageService } from "./packages";
import { ProjectApiService } from "./project-api-service";
import { ProjectService } from "./project-service";
import { PromptService } from "./prompt-service";
import { RunApiService } from "./run-api-service";
import { RunService } from "./run-service";
import { ScheduleApiService } from "./schedule-api-service";
import { createDaemonScheduleExecutor, launchPromptAsRun } from "./schedule-executor";
import { ScheduleService } from "./schedule-service";
import { SessionApiService } from "./session-api-service";
import { SessionService } from "./session-service";
import { WorkflowApiService } from "./workflow-api-service";
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

  readonly approvalApiService: ApprovalApiService;
  readonly modelApiService: ModelApiService;
  readonly packageApiService: PackageApiService;
  readonly projectApiService: ProjectApiService;
  readonly runApiService: RunApiService;
  readonly scheduleApiService: ScheduleApiService;
  readonly sessionApiService: SessionApiService;
  readonly workflowApiService: WorkflowApiService;

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

    this.approvalApiService = new ApprovalApiService(this.approvalService, options.audit);
    this.modelApiService = new ModelApiService(this.modelService, {
      workflowBackend: () => this.workflowService.getBackendInfo(),
      activeModel: () => this.sessionService.listSessions()[0]?.model,
      prompt: (request) => this.callbacks.prompt(request),
      abortSession: (sessionId) => this.callbacks.abortSession(sessionId),
      deleteSession: (sessionId) => this.callbacks.deleteSession(sessionId),
    });
    this.packageApiService = new PackageApiService(this.packageService, options.audit);
    this.projectApiService = new ProjectApiService(this.projectService);
    this.runApiService = new RunApiService(this.runService, this.sessionService);
    this.scheduleApiService = new ScheduleApiService(this.scheduleService);
    this.sessionApiService = new SessionApiService(this.sessionService, this.runService);
    this.workflowApiService = new WorkflowApiService(this.workflowService);
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
}
