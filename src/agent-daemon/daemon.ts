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
    return this.services.projectApiService.listProjects();
  }

  getProject(projectId: string) {
    return this.services.projectApiService.getProject(projectId);
  }

  createProject(request: CreateProjectRequest) {
    return this.services.projectApiService.createProject(request);
  }

  updateProject(projectId: string, request: UpdateProjectRequest) {
    return this.services.projectApiService.updateProject(projectId, request);
  }

  deleteProject(projectId: string) {
    return this.services.projectApiService.deleteProject(projectId);
  }

  async createSession(options: CreateSessionRequest = {}) {
    return this.services.sessionApiService.createSession(options);
  }

  async openSession(options: OpenSessionRequest) {
    return this.services.sessionApiService.openSession(options);
  }

  listSessions(projectId?: string) {
    return this.services.sessionApiService.listSessions(projectId);
  }

  getSession(sessionId: string, projectId?: string) {
    return this.services.sessionApiService.getSession(sessionId, projectId);
  }

  updateSession(sessionId: string, request: UpdateSessionRequest, projectId?: string) {
    return this.services.sessionApiService.updateSession(sessionId, request, projectId);
  }

  deleteSession(sessionId: string, projectId?: string) {
    return this.services.sessionApiService.deleteSession(sessionId, projectId);
  }

  async listStoredSessions(cwd?: string, projectId?: string) {
    return this.services.sessionApiService.listStoredSessions(cwd, projectId);
  }

  listRuns(sessionId?: string, projectId?: string) {
    return this.services.runApiService.listRuns(sessionId, projectId);
  }

  getRun(runId: string, projectId?: string) {
    return this.services.runApiService.getRun(runId, projectId);
  }

  async abortRun(runId: string, projectId?: string) {
    return this.services.runApiService.abortRun(runId, projectId);
  }

  listRunEvents(runId: string, afterEventId?: string, projectId?: string) {
    return this.services.runApiService.listRunEvents(runId, afterEventId, projectId);
  }

  listEvents(query: EventStreamQuery = {}) {
    return this.services.runApiService.listEvents(query);
  }

  subscribeEvents(query: EventStreamQuery, listener: (event: PromptStreamEvent) => void) {
    return this.services.runApiService.subscribeEvents(query, listener);
  }

  createApproval(request: CreateApprovalRequest) {
    return this.services.approvalApiService.createApproval(request);
  }

  listApprovals(status?: ApprovalStatus) {
    return this.services.approvalApiService.listApprovals(status);
  }

  getApproval(approvalId: string) {
    return this.services.approvalApiService.getApproval(approvalId);
  }

  resolveApproval(approvalId: string, request: ResolveApprovalRequest) {
    return this.services.approvalApiService.resolveApproval(approvalId, request);
  }

  listWorkflows(projectId?: string) {
    return this.services.workflowApiService.listWorkflows(projectId);
  }

  startWorkflow(workflowId: string, request: StartWorkflowRequest = {}, projectId?: string) {
    return this.services.workflowApiService.startWorkflow(workflowId, request, projectId);
  }

  async listWorkflowRuns(projectId?: string) {
    return this.services.workflowApiService.listWorkflowRuns(projectId);
  }

  async getWorkflowRun(runId: string, projectId?: string) {
    return this.services.workflowApiService.getWorkflowRun(runId, projectId);
  }

  async listWorkflowStages(runId: string, projectId?: string) {
    return this.services.workflowApiService.listWorkflowStages(runId, projectId);
  }

  async listWorkflowTasks(runId: string, projectId?: string) {
    return this.services.workflowApiService.listWorkflowTasks(runId, projectId);
  }

  async getWorkflowArtifact(artifactId: string, projectId?: string) {
    return this.services.workflowApiService.getWorkflowArtifact(artifactId, projectId);
  }

  async abortWorkflowRun(runId: string, projectId?: string) {
    return this.services.workflowApiService.abortWorkflowRun(runId, projectId);
  }

  listSchedules(projectId?: string) {
    return this.services.scheduleApiService.listSchedules(projectId);
  }

  createSchedule(request: CreateScheduleRequest, projectIdOverride?: string) {
    return this.services.scheduleApiService.createSchedule(request, projectIdOverride);
  }

  updateSchedule(scheduleId: string, request: UpdateScheduleRequest, projectIdOverride?: string) {
    return this.services.scheduleApiService.updateSchedule(scheduleId, request, projectIdOverride);
  }

  getSchedule(scheduleId: string, projectId?: string) {
    return this.services.scheduleApiService.getSchedule(scheduleId, projectId);
  }

  listScheduleRuns(scheduleId?: string, projectId?: string) {
    return this.services.scheduleApiService.listScheduleRuns(scheduleId, projectId);
  }

  getScheduleRun(runId: string, projectId?: string) {
    return this.services.scheduleApiService.getScheduleRun(runId, projectId);
  }

  abortScheduleRun(runId: string, projectId?: string) {
    return this.services.scheduleApiService.abortScheduleRun(runId, projectId);
  }

  pauseSchedule(scheduleId: string, projectId?: string) {
    return this.services.scheduleApiService.pauseSchedule(scheduleId, projectId);
  }

  resumeSchedule(scheduleId: string, projectId?: string) {
    return this.services.scheduleApiService.resumeSchedule(scheduleId, projectId);
  }

  triggerSchedule(scheduleId: string, projectId?: string) {
    return this.services.scheduleApiService.triggerSchedule(scheduleId, projectId);
  }

  deleteSchedule(scheduleId: string, projectId?: string) {
    return this.services.scheduleApiService.deleteSchedule(scheduleId, projectId);
  }

  summarizeSessionTree(sessionId: string) {
    return this.services.sessionApiService.summarizeSessionTree(sessionId);
  }

  summarizeSession(session: Parameters<SessionService["summarizeSession"]>[0]) {
    return this.services.sessionApiService.summarizeSession(session);
  }

  prompt(request: PromptRequest): AsyncGenerator<PromptStreamEvent> {
    return this.services.promptService.prompt(request);
  }

  async abort(sessionId: string) {
    return this.services.sessionApiService.abortSession(sessionId);
  }

  async compact(sessionId: string, instructions?: string) {
    return this.services.sessionApiService.compactSession(sessionId, instructions);
  }

  async newSession(sessionId: string, options: NewSessionRequest = {}) {
    return this.services.sessionApiService.newSession(sessionId, options);
  }

  async switchSession(sessionId: string, options: SwitchSessionRequest) {
    return this.services.sessionApiService.switchSession(sessionId, options);
  }

  async forkSession(sessionId: string, options: ForkSessionRequest) {
    return this.services.sessionApiService.forkSession(sessionId, options);
  }

  async importSession(sessionId: string, options: ImportSessionRequest) {
    return this.services.sessionApiService.importSession(sessionId, options);
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
    return this.services.packageApiService.listPackages();
  }

  async addPackage(request: PackageMutationRequest) {
    return this.services.packageApiService.addPackage(request);
  }

  async installPackage(request: PackageMutationRequest) {
    return this.services.packageApiService.installPackage(request);
  }

  async removePackage(request: PackageMutationRequest) {
    return this.services.packageApiService.removePackage(request);
  }

  async updatePackage(request: PackageMutationRequest) {
    return this.services.packageApiService.updatePackage(request);
  }

  async trustPackage(request: PackageMutationRequest) {
    return this.services.packageApiService.trustPackage(request);
  }

  async revokePackageTrust(request: PackageMutationRequest) {
    return this.services.packageApiService.revokePackageTrust(request);
  }

  listPackageOperations() {
    return this.services.packageApiService.listPackageOperations();
  }

  getPackageOperation(operationId: string) {
    return this.services.packageApiService.getPackageOperation(operationId);
  }

  async dispose() {
    await this.services.dispose();
  }
}
