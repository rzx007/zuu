import type {
  PromptRequest,
  PromptStreamEvent,
} from "@zuu/client";
import type { AuditService } from "./audit-service";
import { ApprovalApiService } from "./approval-api-service";
import type { ApprovalService } from "./approval-service";
import { ModelApiService } from "./model-api-service";
import type { ModelService } from "./model-service";
import { PackageApiService } from "./package-api-service";
import type { PackageService } from "./packages";
import { ProjectApiService } from "./project-api-service";
import type { ProjectService } from "./project-service";
import { RunApiService } from "./run-api-service";
import type { RunService } from "./run-service";
import { ScheduleApiService } from "./schedule-api-service";
import type { ScheduleService } from "./schedule-service";
import { SessionApiService } from "./session-api-service";
import type { SessionService } from "./session-service";
import { WorkflowApiService } from "./workflow-api-service";
import type { WorkflowService } from "./workflow-service";

export interface DaemonApiCallbacks {
  prompt(request: PromptRequest): AsyncGenerator<PromptStreamEvent>;
  abortSession(sessionId: string): Promise<unknown>;
  deleteSession(sessionId: string): Promise<unknown>;
}

export interface DaemonApiServices {
  approvalApiService: ApprovalApiService;
  modelApiService: ModelApiService;
  packageApiService: PackageApiService;
  projectApiService: ProjectApiService;
  runApiService: RunApiService;
  scheduleApiService: ScheduleApiService;
  sessionApiService: SessionApiService;
  workflowApiService: WorkflowApiService;
}

export interface CreateDaemonApiServicesOptions {
  audit?: AuditService;
  callbacks: DaemonApiCallbacks;
  approvalService: ApprovalService;
  modelService: ModelService;
  packageService: PackageService;
  projectService: ProjectService;
  runService: RunService;
  scheduleService: ScheduleService;
  sessionService: SessionService;
  workflowService: WorkflowService;
}

export function createDaemonApiServices(options: CreateDaemonApiServicesOptions): DaemonApiServices {
  return {
    approvalApiService: new ApprovalApiService(options.approvalService, options.audit),
    modelApiService: new ModelApiService(options.modelService, {
      workflowBackend: () => options.workflowService.getBackendInfo(),
      activeModel: () => options.sessionService.listSessions()[0]?.model,
      prompt: (request) => options.callbacks.prompt(request),
      abortSession: (sessionId) => options.callbacks.abortSession(sessionId),
      deleteSession: (sessionId) => options.callbacks.deleteSession(sessionId),
    }),
    packageApiService: new PackageApiService(options.packageService, options.audit),
    projectApiService: new ProjectApiService(options.projectService),
    runApiService: new RunApiService(options.runService, options.sessionService),
    scheduleApiService: new ScheduleApiService(options.scheduleService),
    sessionApiService: new SessionApiService(options.sessionService, options.runService),
    workflowApiService: new WorkflowApiService(options.workflowService),
  };
}
