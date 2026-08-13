import type { AuditService } from "./audit-service";
import { DaemonServiceRegistry } from "./daemon-service-registry";
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
  StartWorkflowRequest,
  SwitchSessionRequest,
  UpdateProjectRequest,
  UpdateScheduleRequest,
  UpdateSessionRequest,
} from "@zuu/client";
import type { SessionService } from "./session-service";

export class ZuuDaemon {
  private readonly services: DaemonServiceRegistry;

  constructor(options: { audit?: AuditService } = {}) {
    this.services = new DaemonServiceRegistry({
      prompt: (request) => this.prompt(request),
      startWorkflow: (workflowId, request) => this.startWorkflow(workflowId, request),
      abortSession: (sessionId) => this.abort(sessionId),
      deleteSession: (sessionId) => this.deleteSession(sessionId),
    }, options);
  }

  listProjects() {
    return this.services.api.projectApiService.listProjects();
  }

  getProject(projectId: string) {
    return this.services.api.projectApiService.getProject(projectId);
  }

  createProject(request: CreateProjectRequest) {
    return this.services.api.projectApiService.createProject(request);
  }

  updateProject(projectId: string, request: UpdateProjectRequest) {
    return this.services.api.projectApiService.updateProject(projectId, request);
  }

  deleteProject(projectId: string) {
    return this.services.api.projectApiService.deleteProject(projectId);
  }

  async createSession(options: CreateSessionRequest = {}) {
    return this.services.api.sessionApiService.createSession(options);
  }

  async openSession(options: OpenSessionRequest) {
    return this.services.api.sessionApiService.openSession(options);
  }

  listSessions(projectId?: string) {
    return this.services.api.sessionApiService.listSessions(projectId);
  }

  getSession(sessionId: string, projectId?: string) {
    return this.services.api.sessionApiService.getSession(sessionId, projectId);
  }

  updateSession(sessionId: string, request: UpdateSessionRequest, projectId?: string) {
    return this.services.api.sessionApiService.updateSession(sessionId, request, projectId);
  }

  deleteSession(sessionId: string, projectId?: string) {
    return this.services.api.sessionApiService.deleteSession(sessionId, projectId);
  }

  async listStoredSessions(cwd?: string, projectId?: string) {
    return this.services.api.sessionApiService.listStoredSessions(cwd, projectId);
  }

  listRuns(sessionId?: string, projectId?: string) {
    return this.services.api.runApiService.listRuns(sessionId, projectId);
  }

  getRun(runId: string, projectId?: string) {
    return this.services.api.runApiService.getRun(runId, projectId);
  }

  async abortRun(runId: string, projectId?: string) {
    return this.services.api.runApiService.abortRun(runId, projectId);
  }

  listRunEvents(runId: string, afterEventId?: string, projectId?: string) {
    return this.services.api.runApiService.listRunEvents(runId, afterEventId, projectId);
  }

  listEvents(query: EventStreamQuery = {}) {
    return this.services.api.runApiService.listEvents(query);
  }

  subscribeEvents(query: EventStreamQuery, listener: (event: PromptStreamEvent) => void) {
    return this.services.api.runApiService.subscribeEvents(query, listener);
  }

  createApproval(request: CreateApprovalRequest) {
    return this.services.api.approvalApiService.createApproval(request);
  }

  listApprovals(status?: ApprovalStatus) {
    return this.services.api.approvalApiService.listApprovals(status);
  }

  getApproval(approvalId: string) {
    return this.services.api.approvalApiService.getApproval(approvalId);
  }

  resolveApproval(approvalId: string, request: ResolveApprovalRequest) {
    return this.services.api.approvalApiService.resolveApproval(approvalId, request);
  }

  listWorkflows(projectId?: string) {
    return this.services.api.workflowApiService.listWorkflows(projectId);
  }

  startWorkflow(workflowId: string, request: StartWorkflowRequest = {}, projectId?: string) {
    return this.services.api.workflowApiService.startWorkflow(workflowId, request, projectId);
  }

  async listWorkflowRuns(projectId?: string) {
    return this.services.api.workflowApiService.listWorkflowRuns(projectId);
  }

  async getWorkflowRun(runId: string, projectId?: string) {
    return this.services.api.workflowApiService.getWorkflowRun(runId, projectId);
  }

  async listWorkflowStages(runId: string, projectId?: string) {
    return this.services.api.workflowApiService.listWorkflowStages(runId, projectId);
  }

  async listWorkflowTasks(runId: string, projectId?: string) {
    return this.services.api.workflowApiService.listWorkflowTasks(runId, projectId);
  }

  async getWorkflowArtifact(artifactId: string, projectId?: string) {
    return this.services.api.workflowApiService.getWorkflowArtifact(artifactId, projectId);
  }

  async abortWorkflowRun(runId: string, projectId?: string) {
    return this.services.api.workflowApiService.abortWorkflowRun(runId, projectId);
  }

  listSchedules(projectId?: string) {
    return this.services.api.scheduleApiService.listSchedules(projectId);
  }

  createSchedule(request: CreateScheduleRequest, projectIdOverride?: string) {
    return this.services.api.scheduleApiService.createSchedule(request, projectIdOverride);
  }

  updateSchedule(scheduleId: string, request: UpdateScheduleRequest, projectIdOverride?: string) {
    return this.services.api.scheduleApiService.updateSchedule(scheduleId, request, projectIdOverride);
  }

  getSchedule(scheduleId: string, projectId?: string) {
    return this.services.api.scheduleApiService.getSchedule(scheduleId, projectId);
  }

  listScheduleRuns(scheduleId?: string, projectId?: string) {
    return this.services.api.scheduleApiService.listScheduleRuns(scheduleId, projectId);
  }

  getScheduleRun(runId: string, projectId?: string) {
    return this.services.api.scheduleApiService.getScheduleRun(runId, projectId);
  }

  abortScheduleRun(runId: string, projectId?: string) {
    return this.services.api.scheduleApiService.abortScheduleRun(runId, projectId);
  }

  pauseSchedule(scheduleId: string, projectId?: string) {
    return this.services.api.scheduleApiService.pauseSchedule(scheduleId, projectId);
  }

  resumeSchedule(scheduleId: string, projectId?: string) {
    return this.services.api.scheduleApiService.resumeSchedule(scheduleId, projectId);
  }

  triggerSchedule(scheduleId: string, projectId?: string) {
    return this.services.api.scheduleApiService.triggerSchedule(scheduleId, projectId);
  }

  deleteSchedule(scheduleId: string, projectId?: string) {
    return this.services.api.scheduleApiService.deleteSchedule(scheduleId, projectId);
  }

  summarizeSessionTree(sessionId: string) {
    return this.services.api.sessionApiService.summarizeSessionTree(sessionId);
  }

  summarizeSession(session: Parameters<SessionService["summarizeSession"]>[0]) {
    return this.services.api.sessionApiService.summarizeSession(session);
  }

  prompt(request: PromptRequest): AsyncGenerator<PromptStreamEvent> {
    return this.services.core.promptService.prompt(request);
  }

  async abort(sessionId: string) {
    return this.services.api.sessionApiService.abortSession(sessionId);
  }

  async compact(sessionId: string, instructions?: string) {
    return this.services.api.sessionApiService.compactSession(sessionId, instructions);
  }

  async newSession(sessionId: string, options: NewSessionRequest = {}) {
    return this.services.api.sessionApiService.newSession(sessionId, options);
  }

  async switchSession(sessionId: string, options: SwitchSessionRequest) {
    return this.services.api.sessionApiService.switchSession(sessionId, options);
  }

  async forkSession(sessionId: string, options: ForkSessionRequest) {
    return this.services.api.sessionApiService.forkSession(sessionId, options);
  }

  async importSession(sessionId: string, options: ImportSessionRequest) {
    return this.services.api.sessionApiService.importSession(sessionId, options);
  }

  async diagnostics() {
    return this.services.diagnostics();
  }

  async listModels() {
    return this.services.listModels();
  }

  async smokeModel(request: ModelSmokeRequest = {}): Promise<ModelSmokeResponse> {
    return this.services.smokeModel(request);
  }

  listPackages() {
    return this.services.api.packageApiService.listPackages();
  }

  async addPackage(request: PackageMutationRequest) {
    return this.services.api.packageApiService.addPackage(request);
  }

  async installPackage(request: PackageMutationRequest) {
    return this.services.api.packageApiService.installPackage(request);
  }

  async removePackage(request: PackageMutationRequest) {
    return this.services.api.packageApiService.removePackage(request);
  }

  async updatePackage(request: PackageMutationRequest) {
    return this.services.api.packageApiService.updatePackage(request);
  }

  async trustPackage(request: PackageMutationRequest) {
    return this.services.api.packageApiService.trustPackage(request);
  }

  async revokePackageTrust(request: PackageMutationRequest) {
    return this.services.api.packageApiService.revokePackageTrust(request);
  }

  listPackageOperations() {
    return this.services.api.packageApiService.listPackageOperations();
  }

  getPackageOperation(operationId: string) {
    return this.services.api.packageApiService.getPackageOperation(operationId);
  }

  async dispose() {
    await this.services.dispose();
  }
}
