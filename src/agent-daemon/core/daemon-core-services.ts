import {
  createEventBus,
  type EventBusController,
} from "@earendil-works/pi-coding-agent";
import type {
  PromptRequest,
  PromptStreamEvent,
  StartWorkflowRequest,
  WorkflowRun,
} from "@zuu/client";
import { ApprovalService } from "../approvals/approval-service";
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
} from "./agent-paths";
import { ModelService } from "../models/model-service";
import { PackageService } from "../packages/packages";
import { ProjectService } from "../projects/project-service";
import { PromptService } from "../prompts/prompt-service";
import { RunService } from "../runs/run-service";
import { createDaemonScheduleExecutor, launchPromptAsRun } from "../schedules/schedule-executor";
import { ScheduleService } from "../schedules/schedule-service";
import { SessionService } from "../sessions/session-service";
import { WorkflowService } from "../workflows/workflow-service";

export interface DaemonCoreCallbacks {
  prompt(request: PromptRequest): AsyncGenerator<PromptStreamEvent>;
  startWorkflow(workflowId: string, request: StartWorkflowRequest): Promise<WorkflowRun>;
}

export interface DaemonCoreServices {
  agentDir: string;
  activeRunBySessionId: Map<string, string>;
  approvalWaitBySessionId: Map<string, boolean>;
  eventBus: EventBusController;
  startedAt: string;
  approvalService: ApprovalService;
  modelService: ModelService;
  projectService: ProjectService;
  runService: RunService;
  packageService: PackageService;
  workflowService: WorkflowService;
  sessionService: SessionService;
  promptService: PromptService;
  scheduleService: ScheduleService;
}

export function createDaemonCoreServices(callbacks: DaemonCoreCallbacks): DaemonCoreServices {
  const agentDir = getZuuAgentDir();
  const activeRunBySessionId = new Map<string, string>();
  const approvalWaitBySessionId = new Map<string, boolean>();
  const eventBus = createEventBus();
  const startedAt = new Date().toISOString();

  const approvalService = new ApprovalService(getApprovalStorePath(agentDir));
  const modelService = new ModelService();
  const projectService = new ProjectService(getProjectStorePath(agentDir), agentDir);
  const runService = new RunService(getRunStorePath(agentDir), getRunEventStorePath(agentDir));
  const packageService = new PackageService(
    process.cwd(),
    agentDir,
    getPackageOperationStorePath(agentDir),
    getPackageTrustStorePath(agentDir),
  );
  const workflowService = new WorkflowService({
    agentDir,
    packageService,
    projects: projectService,
    runPrompt: (request) => callbacks.prompt(request),
    launchPrompt: (request) => launchPromptAsRun((promptRequest) => callbacks.prompt(promptRequest), request),
  });
  const sessionService = new SessionService({
    agentDir,
    projects: projectService,
    packageService,
    modelRuntimePromise: modelService.getRuntimePromise(),
    approvals: approvalService,
    activeRunBySessionId,
    approvalWaitBySessionId,
    eventBus,
    startedAt,
  });
  const promptService = new PromptService({
    sessions: sessionService,
    runs: runService,
    eventBus,
    activeRunBySessionId,
    approvalWaitBySessionId,
  });
  const scheduleService = new ScheduleService({
    path: getScheduleStorePath(agentDir),
    leasePath: getScheduleLeaseStorePath(agentDir),
    projects: projectService,
    executor: createDaemonScheduleExecutor({
      prompt: (request) => callbacks.prompt(request),
      startWorkflow: (workflowId, request) => callbacks.startWorkflow(workflowId, request),
    }),
  });

  return {
    agentDir,
    activeRunBySessionId,
    approvalWaitBySessionId,
    eventBus,
    startedAt,
    approvalService,
    modelService,
    projectService,
    runService,
    packageService,
    workflowService,
    sessionService,
    promptService,
    scheduleService,
  };
}
