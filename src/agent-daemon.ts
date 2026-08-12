import { fileURLToPath } from "node:url";
import {
  createEventBus,
  type EventBusController,
} from "@earendil-works/pi-coding-agent";
import type { AuditService } from "./agent-daemon/audit-service";
import {
  getApprovalStorePath,
  getPackageOperationStorePath,
  getPackageTrustStorePath,
  getProjectStorePath,
  getRunEventStorePath,
  getRunStorePath,
  getScheduleStorePath,
  getZuuAgentDir,
} from "./agent-daemon/environment";
import { ApprovalService } from "./agent-daemon/approval-service";
import { ApprovalApiService } from "./agent-daemon/approval-api-service";
import { ModelService } from "./agent-daemon/model-service";
import { ProjectService } from "./agent-daemon/project-service";
import { ScheduleService } from "./agent-daemon/schedule-service";
import { PackageApiService } from "./agent-daemon/package-api-service";
import { PackageService } from "./agent-daemon/packages";
import { PromptService } from "./agent-daemon/prompt-service";
import { WorkflowService } from "./agent-daemon/workflow-service";
import type {
  CreateScheduleRequest,
  CreateSessionRequest,
  CreateProjectRequest,
  EventStreamQuery,
  ForkSessionRequest,
  ImportSessionRequest,
  ModelSmokeRequest,
  ModelSmokeResponse,
  NewSessionRequest,
  OpenSessionRequest,
  ApprovalStatus,
  CreateApprovalRequest,
  PackageMutationRequest,
  PromptRequest,
  PromptStreamEvent,
  ResolveApprovalRequest,
  RunSummary,
  StartWorkflowRequest,
  SwitchSessionRequest,
  UpdateProjectRequest,
  UpdateScheduleRequest,
  UpdateSessionRequest,
} from "@zuu/client";
import { runModelSmoke } from "./agent-daemon/model-smoke";
import { RunApiService } from "./agent-daemon/run-api-service";
import { RunService } from "./agent-daemon/run-service";
import { SessionService } from "./agent-daemon/session-service";

export class ZuuDaemon {
  private readonly approvalApiService: ApprovalApiService;
  private readonly packageApiService: PackageApiService;
  private readonly runApiService: RunApiService;

  constructor(options: { audit?: AuditService } = {}) {
    this.approvalApiService = new ApprovalApiService(this.approvalService, options.audit);
    this.packageApiService = new PackageApiService(this.packageService, options.audit);
    this.runApiService = new RunApiService(this.runService, this.sessionService);
  }

  private readonly agentDir = getZuuAgentDir();
  private readonly runService = new RunService(getRunStorePath(this.agentDir), getRunEventStorePath(this.agentDir));
  private readonly projectService = new ProjectService(getProjectStorePath(this.agentDir), this.agentDir);
  private readonly approvalService = new ApprovalService(getApprovalStorePath(this.agentDir));
  private readonly modelService = new ModelService();
  private readonly activeRunBySessionId = new Map<string, string>();
  private readonly eventBus: EventBusController = createEventBus();
  private readonly packageService = new PackageService(
    process.cwd(),
    this.agentDir,
    getPackageOperationStorePath(this.agentDir),
    getPackageTrustStorePath(this.agentDir),
  );
  private readonly workflowService = new WorkflowService({
    agentDir: this.agentDir,
    packageService: this.packageService,
    projects: this.projectService,
    launchPrompt: (request) => this.launchWorkflowPrompt(request),
  });
  private readonly startedAt = new Date().toISOString();
  private readonly sessionService = new SessionService({
    agentDir: this.agentDir,
    projects: this.projectService,
    packageService: this.packageService,
    modelRuntimePromise: this.modelService.getRuntimePromise(),
    approvals: this.approvalService,
    activeRunBySessionId: this.activeRunBySessionId,
    eventBus: this.eventBus,
    startedAt: this.startedAt,
  });
  private readonly promptService = new PromptService({
    sessions: this.sessionService,
    runs: this.runService,
    eventBus: this.eventBus,
    activeRunBySessionId: this.activeRunBySessionId,
  });
  private readonly scheduleService = new ScheduleService({
    path: getScheduleStorePath(this.agentDir),
    projects: this.projectService,
    executor: {
      runPrompt: async (action) => {
        const { type: _type, ...request } = action;
        let agentRunId: string | undefined;
        for await (const event of this.prompt({ ...request, source: "schedule" })) {
          agentRunId = event.run?.id ?? event.runId ?? agentRunId;
        }
        return { agentRunId };
      },
      runWorkflow: async (action) => {
        const run = await this.startWorkflow(action.workflowId, {
          projectId: action.projectId,
          sessionId: action.sessionId,
          prompt: action.prompt,
          inputs: action.inputs,
          source: "schedule",
        });
        return { workflowRunId: run.id };
      },
    },
  });

  listProjects() {
    return this.projectService.listProjects();
  }

  getProject(projectId: string) {
    return this.projectService.get(projectId);
  }

  createProject(request: CreateProjectRequest) {
    return this.projectService.createProject(request);
  }

  updateProject(projectId: string, request: UpdateProjectRequest) {
    return this.projectService.updateProject(projectId, request);
  }

  deleteProject(projectId: string) {
    return this.projectService.deleteProject(projectId);
  }

  async createSession(options: CreateSessionRequest = {}) {
    return this.sessionService.createSession(options);
  }

  async openSession(options: OpenSessionRequest) {
    return this.sessionService.openSession(options);
  }

  listSessions(projectId?: string) {
    return this.sessionService.listSessions(projectId);
  }

  getSession(sessionId: string, projectId?: string) {
    return this.sessionService.getSession(sessionId, projectId);
  }

  updateSession(sessionId: string, request: UpdateSessionRequest, projectId?: string) {
    return this.sessionService.updateSession(sessionId, request, projectId);
  }

  deleteSession(sessionId: string, projectId?: string) {
    return this.sessionService.deleteSession(sessionId, projectId);
  }

  async listStoredSessions(cwd?: string, projectId?: string) {
    return this.sessionService.listStoredSessions(cwd, projectId);
  }

  listRuns(sessionId?: string, projectId?: string) {
    return this.runApiService.listRuns(sessionId, projectId);
  }

  getRun(runId: string, projectId?: string) {
    return this.runApiService.getRun(runId, projectId);
  }

  async abortRun(runId: string, projectId?: string) {
    return this.runApiService.abortRun(runId, projectId);
  }

  listRunEvents(runId: string, afterEventId?: string, projectId?: string) {
    return this.runApiService.listRunEvents(runId, afterEventId, projectId);
  }

  listEvents(query: EventStreamQuery = {}) {
    return this.runApiService.listEvents(query);
  }

  subscribeEvents(query: EventStreamQuery, listener: (event: PromptStreamEvent) => void) {
    return this.runApiService.subscribeEvents(query, listener);
  }

  createApproval(request: CreateApprovalRequest) {
    return this.approvalApiService.createApproval(request);
  }

  listApprovals(status?: ApprovalStatus) {
    return this.approvalApiService.listApprovals(status);
  }

  getApproval(approvalId: string) {
    return this.approvalApiService.getApproval(approvalId);
  }

  resolveApproval(approvalId: string, request: ResolveApprovalRequest) {
    return this.approvalApiService.resolveApproval(approvalId, request);
  }

  listWorkflows(projectId?: string) {
    return this.workflowService.listWorkflows(projectId);
  }

  startWorkflow(workflowId: string, request: StartWorkflowRequest = {}, projectId?: string) {
    return this.workflowService.startWorkflow(workflowId, request, projectId);
  }

  async listWorkflowRuns(projectId?: string) {
    return this.workflowService.listWorkflowRuns(projectId);
  }

  async getWorkflowRun(runId: string, projectId?: string) {
    return this.workflowService.getWorkflowRun(runId, projectId);
  }

  async listWorkflowStages(runId: string, projectId?: string) {
    return this.workflowService.listWorkflowStages(runId, projectId);
  }

  async listWorkflowTasks(runId: string, projectId?: string) {
    return this.workflowService.listWorkflowTasks(runId, projectId);
  }

  async getWorkflowArtifact(artifactId: string, projectId?: string) {
    return this.workflowService.getWorkflowArtifact(artifactId, projectId);
  }

  async abortWorkflowRun(runId: string, projectId?: string) {
    return this.workflowService.abortWorkflowRun(runId, projectId);
  }

  private async launchWorkflowPrompt(request: PromptRequest) {
    let finalRun: RunSummary | undefined;
    for await (const event of this.prompt(request)) {
      finalRun = event.run ?? finalRun;
    }
    if (!finalRun) throw new Error("Workflow launch did not produce an agent run");
    return finalRun;
  }

  listSchedules(projectId?: string) {
    return this.scheduleService.listSchedules(projectId);
  }

  createSchedule(request: CreateScheduleRequest, projectIdOverride?: string) {
    return this.scheduleService.createSchedule(request, projectIdOverride);
  }

  updateSchedule(scheduleId: string, request: UpdateScheduleRequest, projectIdOverride?: string) {
    return this.scheduleService.updateSchedule(scheduleId, request, projectIdOverride);
  }

  getSchedule(scheduleId: string, projectId?: string) {
    return this.scheduleService.getSchedule(scheduleId, projectId);
  }

  listScheduleRuns(scheduleId?: string, projectId?: string) {
    return this.scheduleService.listScheduleRuns(scheduleId, projectId);
  }

  getScheduleRun(runId: string, projectId?: string) {
    return this.scheduleService.getScheduleRun(runId, projectId);
  }

  abortScheduleRun(runId: string, projectId?: string) {
    return this.scheduleService.abortScheduleRun(runId, projectId);
  }

  pauseSchedule(scheduleId: string, projectId?: string) {
    return this.scheduleService.pauseSchedule(scheduleId, projectId);
  }

  resumeSchedule(scheduleId: string, projectId?: string) {
    return this.scheduleService.resumeSchedule(scheduleId, projectId);
  }

  triggerSchedule(scheduleId: string, projectId?: string) {
    return this.scheduleService.triggerSchedule(scheduleId, projectId);
  }

  deleteSchedule(scheduleId: string, projectId?: string) {
    return this.scheduleService.deleteSchedule(scheduleId, projectId);
  }

  summarizeSessionTree(sessionId: string) {
    return this.sessionService.summarizeSessionTree(sessionId);
  }

  summarizeSession(session: Parameters<SessionService["summarizeSession"]>[0]) {
    return this.sessionService.summarizeSession(session);
  }

  prompt(request: PromptRequest): AsyncGenerator<PromptStreamEvent> {
    return this.promptService.prompt(request);
  }

  async abort(sessionId: string) {
    const session = await this.sessionService.abort(sessionId);
    this.runService.abortSessionRuns(sessionId);
    return session;
  }

  async compact(sessionId: string, instructions?: string) {
    return this.sessionService.compact(sessionId, instructions);
  }

  async newSession(sessionId: string, options: NewSessionRequest = {}) {
    return this.sessionService.newSession(sessionId, options);
  }

  async switchSession(sessionId: string, options: SwitchSessionRequest) {
    return this.sessionService.switchSession(sessionId, options);
  }

  async forkSession(sessionId: string, options: ForkSessionRequest) {
    return this.sessionService.forkSession(sessionId, options);
  }

  async importSession(sessionId: string, options: ImportSessionRequest) {
    return this.sessionService.importSession(sessionId, options);
  }

  async diagnostics() {
    return this.modelService.diagnostics(this.workflowService.getBackendInfo(), this.listSessions()[0]?.model);
  }

  async listModels() {
    return this.modelService.listModels();
  }

  async smokeModel(request: ModelSmokeRequest = {}): Promise<ModelSmokeResponse> {
    return runModelSmoke(request, {
      prompt: (promptRequest) => this.prompt(promptRequest),
      abortSession: (sessionId) => this.abort(sessionId),
      deleteSession: (sessionId) => this.deleteSession(sessionId),
    });
  }

  listPackages() {
    return this.packageApiService.listPackages();
  }

  async addPackage(request: PackageMutationRequest) {
    return this.packageApiService.addPackage(request);
  }

  async installPackage(request: PackageMutationRequest) {
    return this.packageApiService.installPackage(request);
  }

  async removePackage(request: PackageMutationRequest) {
    return this.packageApiService.removePackage(request);
  }

  async updatePackage(request: PackageMutationRequest) {
    return this.packageApiService.updatePackage(request);
  }

  async trustPackage(request: PackageMutationRequest) {
    return this.packageApiService.trustPackage(request);
  }

  async revokePackageTrust(request: PackageMutationRequest) {
    return this.packageApiService.revokePackageTrust(request);
  }

  listPackageOperations() {
    return this.packageApiService.listPackageOperations();
  }

  getPackageOperation(operationId: string) {
    return this.packageApiService.getPackageOperation(operationId);
  }

  async dispose() {
    this.scheduleService.dispose();
    await this.sessionService.dispose();
    this.runService.clear();
  }
}

export function getStaticPath(pathname: string) {
  return fileURLToPath(new URL(pathname, import.meta.url));
}
