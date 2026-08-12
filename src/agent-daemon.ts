import { fileURLToPath } from "node:url";
import {
  createEventBus,
  type EventBusController,
} from "@earendil-works/pi-coding-agent";
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
import { subscribeApprovalEvents } from "./agent-daemon/approval-policy";
import { compactAgentEvent } from "./agent-daemon/events";
import { ModelService } from "./agent-daemon/model-service";
import { ProjectService } from "./agent-daemon/project-service";
import { ScheduleService } from "./agent-daemon/schedule-service";
import { PackageService } from "./agent-daemon/packages";
import { WorkflowService } from "./agent-daemon/workflow-service";
import type {
  CreateScheduleRequest,
  CreateSessionRequest,
  CreateProjectRequest,
  EventStreamQuery,
  ForkSessionRequest,
  ImportSessionRequest,
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
} from "@zuu/client";
import type { RunEventDraft } from "./agent-daemon/run-events";
import { RunService } from "./agent-daemon/run-service";
import { SessionService } from "./agent-daemon/session-service";

export class ZuuDaemon {
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
  private readonly scheduleService = new ScheduleService({
    path: getScheduleStorePath(this.agentDir),
    projects: this.projectService,
    executor: {
      runPrompt: async (action) => {
        const { type: _type, ...request } = action;
        let agentRunId: string | undefined;
        for await (const event of this.prompt(request)) {
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

  async listStoredSessions(cwd?: string, projectId?: string) {
    return this.sessionService.listStoredSessions(cwd, projectId);
  }

  listRuns(sessionId?: string, projectId?: string) {
    return this.runService.listRuns(sessionId, projectId);
  }

  getRun(runId: string, projectId?: string) {
    return this.runService.getRun(runId, projectId);
  }

  listRunEvents(runId: string, afterEventId?: string, projectId?: string) {
    return this.runService.listRunEvents(runId, afterEventId, projectId);
  }

  listEvents(query: EventStreamQuery = {}) {
    return this.runService.listEvents(query);
  }

  subscribeEvents(query: EventStreamQuery, listener: (event: PromptStreamEvent) => void) {
    return this.runService.subscribeEvents(query, listener);
  }

  createApproval(request: CreateApprovalRequest) {
    return this.approvalService.create(request);
  }

  listApprovals(status?: ApprovalStatus) {
    return this.approvalService.listApprovals(status);
  }

  getApproval(approvalId: string) {
    return this.approvalService.getApproval(approvalId);
  }

  resolveApproval(approvalId: string, request: ResolveApprovalRequest) {
    return this.approvalService.resolveApproval(approvalId, request);
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

  getSchedule(scheduleId: string, projectId?: string) {
    return this.scheduleService.getSchedule(scheduleId, projectId);
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

  async *prompt(request: PromptRequest): AsyncGenerator<PromptStreamEvent> {
    const session = await this.sessionService.getOrCreateSession(request);
    this.sessionService.touchSession(session.sessionId);

    if (request.tools) {
      session.setActiveToolsByName(request.tools);
    }

    const run = this.runService.startRun({
      sessionId: session.sessionId,
      projectId: this.sessionService.getProjectId(session.sessionId),
      request,
    });
    const runId = run.id;
    this.activeRunBySessionId.set(session.sessionId, runId);
    const recordAndPublish = this.runService.createEventRecorder(runId);

    yield recordAndPublish({ runId, type: "session", session: this.sessionService.summarizeSession(session), run });

    const queue: RunEventDraft[] = [];
    let notify: (() => void) | undefined;
    let finished = false;
    let promptError: unknown;
    let sawError = false;

    const wake = () => {
      notify?.();
      notify = undefined;
    };

    const unsubscribe = session.subscribe((event) => {
      const compact = compactAgentEvent(event, runId);
      if (compact) {
        if (compact.type === "error") sawError = true;
        queue.push(compact);
        wake();
      }
    });
    const unsubscribeApprovalEvents = subscribeApprovalEvents(this.eventBus, runId, (event) => {
      queue.push(event);
      wake();
    });

    session
      .prompt(request.prompt)
      .catch((error) => {
        promptError = error;
      })
      .finally(() => {
        finished = true;
        wake();
      });

    try {
      while (!finished || queue.length > 0) {
        const next = queue.shift();
        if (next) {
          yield recordAndPublish(next);
          continue;
        }

        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }

      if (promptError) {
        const message = promptError instanceof Error ? promptError.message : String(promptError);
        run.status = run.status === "aborted" ? "aborted" : "error";
        run.endedAt = new Date().toISOString();
        this.runService.saveRun(run);
        yield recordAndPublish({ runId, type: "error", message, run });
        return;
      }

      this.sessionService.touchSession(session.sessionId);
      run.status = run.status === "aborted" ? "aborted" : sawError ? "error" : "done";
      run.endedAt = new Date().toISOString();
      this.runService.saveRun(run);
      yield recordAndPublish({ runId, type: "done", session: this.sessionService.summarizeSession(session), run });
    } finally {
      if (this.activeRunBySessionId.get(session.sessionId) === runId) {
        this.activeRunBySessionId.delete(session.sessionId);
      }
      unsubscribeApprovalEvents();
      unsubscribe();
    }
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

  listPackages() {
    return this.packageService.list();
  }

  async addPackage(request: PackageMutationRequest) {
    return this.packageService.add(request);
  }

  async installPackage(request: PackageMutationRequest) {
    return this.packageService.install(request);
  }

  removePackage(request: PackageMutationRequest) {
    return this.packageService.remove(request);
  }

  updatePackage(request: PackageMutationRequest) {
    return this.packageService.update(request);
  }

  trustPackage(request: PackageMutationRequest) {
    return this.packageService.trustPackage(request);
  }

  revokePackageTrust(request: PackageMutationRequest) {
    return this.packageService.revokeTrust(request);
  }

  listPackageOperations() {
    return this.packageService.listOperations();
  }

  getPackageOperation(operationId: string) {
    return this.packageService.getOperation(operationId);
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
