import { fileURLToPath } from "node:url";
import {
  createEventBus,
  createAgentSessionRuntime,
  SessionManager,
  type AgentSession,
  type EventBusController,
  type SessionInfo,
  type SessionTreeNode,
} from "@earendil-works/pi-coding-agent";
import {
  assertAllowedPath,
  createModelRuntime,
  getApprovalStorePath,
  getPackageOperationStorePath,
  getPackageTrustStorePath,
  getProjectStorePath,
  getRunEventStorePath,
  getRunStorePath,
  getScheduleStorePath,
  getSessionDir,
  getZuuAgentDir,
} from "./agent-daemon/environment";
import { ApprovalStore, assertApprovalStatus } from "./agent-daemon/approval-store";
import { subscribeApprovalEvents } from "./agent-daemon/approval-policy";
import { buildDiagnostics } from "./agent-daemon/diagnostics";
import { compactAgentEvent, entryRole, entryText } from "./agent-daemon/events";
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
  SessionActionResponse,
  SessionSummary,
  SessionTreeEntry,
  StartWorkflowRequest,
  StoredSessionSummary,
  SwitchSessionRequest,
  ThinkingLevel,
  UpdateProjectRequest,
} from "@zuu/client";
import type { RunEventDraft } from "./agent-daemon/run-events";
import { RunService } from "./agent-daemon/run-service";
import {
  bindManagedRuntime,
  createManagedSessionManager,
  createZuuRuntimeFactory,
  type CreateSessionOptions,
  type ManagedRuntime,
} from "./agent-daemon/session-runtime";

export class ZuuDaemon {
  private readonly runtimes = new Map<string, ManagedRuntime>();
  private readonly agentDir = getZuuAgentDir();
  private readonly runService = new RunService(getRunStorePath(this.agentDir), getRunEventStorePath(this.agentDir));
  private readonly projectService = new ProjectService(getProjectStorePath(this.agentDir), this.agentDir);
  private readonly approvalStore = new ApprovalStore(getApprovalStorePath(this.agentDir));
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
  private readonly modelRuntimePromise = createModelRuntime();
  private readonly startedAt = new Date().toISOString();
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

  private findRuntimeBySessionFile(sessionFile: string) {
    return [...this.runtimes.values()].find((managed) => managed.runtime.session.sessionFile === sessionFile);
  }

  async createSession(options: CreateSessionOptions = {}) {
    if (options.sessionFile) {
      assertAllowedPath(options.sessionFile, "sessionFile");
      const existing = this.findRuntimeBySessionFile(options.sessionFile);
      if (existing) {
        if (options.projectId && existing.projectId !== options.projectId) {
          throw new Error(`Session file is already open in project ${existing.projectId}`);
        }
        return existing.runtime.session;
      }
    }

    const project = this.projectService.resolveProject(options);
    const cwd = project.cwd;
    assertAllowedPath(cwd, "cwd");
    const agentDir = getZuuAgentDir();
    const sessionDir = getSessionDir(agentDir);
    const sessionManager = createManagedSessionManager(options, cwd, sessionDir);
    const runtimeCwd = sessionManager.getCwd();

    const runtimeFactory = createZuuRuntimeFactory(
      {
        packageService: this.packageService,
        modelRuntimePromise: this.modelRuntimePromise,
        approvalStore: this.approvalStore,
        activeRunBySessionId: this.activeRunBySessionId,
        eventBus: this.eventBus,
        startedAt: this.startedAt,
        getSessionCount: () => this.runtimes.size,
      },
      options,
    );
    const runtime = await createAgentSessionRuntime(
      runtimeFactory,
      {
        cwd: runtimeCwd,
        agentDir,
        sessionManager,
      },
    );
    const session = runtime.session;

    if (options.name) session.setSessionName(options.name);

    const now = new Date().toISOString();
    const managed: ManagedRuntime = {
      runtime,
      projectId: project.id,
      cwd: runtime.cwd,
      createdAt: now,
      updatedAt: now,
    };
    bindManagedRuntime(this.runtimes, managed);
    this.runtimes.set(session.sessionId, managed);
    return session;
  }

  async openSession(options: OpenSessionRequest) {
    if (!options.sessionFile || typeof options.sessionFile !== "string") {
      throw new Error("sessionFile is required");
    }

    return this.createSession({
      ...options,
      projectId: options.projectId,
      cwd: options.cwdOverride,
      sessionFile: options.sessionFile,
    });
  }

  async getOrCreateSession(options: CreateSessionOptions & { sessionId?: string }) {
    if (options.sessionId) {
      const existing = this.runtimes.get(options.sessionId);
      if (existing) {
        if (options.projectId && existing.projectId !== options.projectId) {
          throw new Error(`Session ${options.sessionId} does not belong to project ${options.projectId}`);
        }
        return existing.runtime.session;
      }
      throw new Error(`Unknown session: ${options.sessionId}`);
    }

    return this.createSession(options);
  }

  listSessions(projectId?: string) {
    if (projectId) this.projectService.get(projectId);
    return [...this.runtimes.values()]
      .filter((item) => !projectId || item.projectId === projectId)
      .map((item) => this.summarizeSession(item.runtime.session));
  }

  async listStoredSessions(cwd?: string, projectId?: string) {
    const projectCwd = projectId ? this.projectService.get(projectId).cwd : undefined;
    const targetCwd = cwd ?? projectCwd;
    if (targetCwd) assertAllowedPath(targetCwd, "cwd");
    const agentDir = getZuuAgentDir();
    const sessionDir = getSessionDir(agentDir);
    const sessions = targetCwd ? await SessionManager.list(targetCwd, sessionDir) : await SessionManager.listAll(sessionDir);
    return sessions
      .map((session) => this.summarizeStoredSession(session, projectId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
    return this.approvalStore.create(request);
  }

  listApprovals(status?: ApprovalStatus) {
    assertApprovalStatus(status);
    return this.approvalStore.list(status);
  }

  getApproval(approvalId: string) {
    return this.approvalStore.get(approvalId);
  }

  resolveApproval(approvalId: string, request: ResolveApprovalRequest) {
    return this.approvalStore.resolve(approvalId, request);
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

  private getManagedRuntime(sessionId: string) {
    const managed = this.runtimes.get(sessionId);
    if (!managed) throw new Error(`Unknown session: ${sessionId}`);
    return managed;
  }

  private summarizeRuntimeAction(managed: ManagedRuntime, result: { cancelled: boolean; selectedText?: string }): SessionActionResponse {
    managed.cwd = managed.runtime.cwd;
    managed.updatedAt = new Date().toISOString();
    return {
      session: this.summarizeSession(managed.runtime.session),
      cancelled: result.cancelled,
      selectedText: result.selectedText,
    };
  }

  summarizeSession(session: AgentSession): SessionSummary {
    const managed = this.runtimes.get(session.sessionId);
    return {
      id: session.sessionId,
      projectId: managed?.projectId ?? this.projectService.get().id,
      name: session.sessionName,
      cwd: managed?.cwd ?? process.cwd(),
      model: session.model ? `${session.model.provider}/${session.model.id}` : undefined,
      thinkingLevel: session.thinkingLevel as ThinkingLevel,
      activeTools: session.getActiveToolNames(),
      messageCount: session.messages.length,
      isStreaming: session.isStreaming,
      sessionFile: session.sessionFile,
      createdAt: managed?.createdAt ?? new Date().toISOString(),
      updatedAt: managed?.updatedAt ?? new Date().toISOString(),
    };
  }

  summarizeStoredSession(session: SessionInfo, projectId?: string): StoredSessionSummary {
    return {
      id: session.id,
      path: session.path,
      projectId,
      cwd: session.cwd,
      name: session.name,
      parentSessionPath: session.parentSessionPath,
      createdAt: session.created.toISOString(),
      updatedAt: session.modified.toISOString(),
      messageCount: session.messageCount,
      firstMessage: session.firstMessage,
      isActive: [...this.runtimes.values()].some((runtime) => runtime.runtime.session.sessionFile === session.path),
    };
  }

  summarizeSessionTree(sessionId: string) {
    const managed = this.getManagedRuntime(sessionId);
    const visit = (node: SessionTreeNode): SessionTreeEntry => ({
      id: node.entry.id,
      parentId: node.entry.parentId,
      type: node.entry.type,
      timestamp: node.entry.timestamp,
      label: node.label,
      role: entryRole(node.entry),
      text: entryText(node.entry),
      children: node.children.map(visit),
    });

    return managed.runtime.session.sessionManager.getTree().map(visit);
  }

  async *prompt(request: PromptRequest): AsyncGenerator<PromptStreamEvent> {
    const session = await this.getOrCreateSession(request);
    const managed = this.runtimes.get(session.sessionId);
    if (managed) managed.updatedAt = new Date().toISOString();

    if (request.tools) {
      session.setActiveToolsByName(request.tools);
    }

    const run = this.runService.startRun({
      sessionId: session.sessionId,
      projectId: this.getManagedRuntime(session.sessionId).projectId,
      request,
    });
    const runId = run.id;
    this.activeRunBySessionId.set(session.sessionId, runId);
    const recordAndPublish = this.runService.createEventRecorder(runId);

    yield recordAndPublish({ runId, type: "session", session: this.summarizeSession(session), run });

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

      if (managed) managed.updatedAt = new Date().toISOString();
      run.status = run.status === "aborted" ? "aborted" : sawError ? "error" : "done";
      run.endedAt = new Date().toISOString();
      this.runService.saveRun(run);
      yield recordAndPublish({ runId, type: "done", session: this.summarizeSession(session), run });
    } finally {
      if (this.activeRunBySessionId.get(session.sessionId) === runId) {
        this.activeRunBySessionId.delete(session.sessionId);
      }
      unsubscribeApprovalEvents();
      unsubscribe();
    }
  }

  async abort(sessionId: string) {
    const managed = this.getManagedRuntime(sessionId);
    await managed.runtime.session.abort();
    managed.updatedAt = new Date().toISOString();
    this.runService.abortSessionRuns(sessionId);
    return this.summarizeSession(managed.runtime.session);
  }

  async compact(sessionId: string, instructions?: string) {
    const managed = this.getManagedRuntime(sessionId);
    await managed.runtime.session.compact(instructions);
    managed.updatedAt = new Date().toISOString();
    return this.summarizeSession(managed.runtime.session);
  }

  async newSession(sessionId: string, options: NewSessionRequest = {}) {
    const managed = this.getManagedRuntime(sessionId);
    const result = await managed.runtime.newSession({ parentSession: options.parentSession });
    if (!result.cancelled && options.name) {
      managed.runtime.session.setSessionName(options.name);
    }
    return this.summarizeRuntimeAction(managed, result);
  }

  async switchSession(sessionId: string, options: SwitchSessionRequest) {
    if (!options.sessionFile || typeof options.sessionFile !== "string") {
      throw new Error("sessionFile is required");
    }

    const managed = this.getManagedRuntime(sessionId);
    if (options.cwdOverride) assertAllowedPath(options.cwdOverride, "cwdOverride");
    assertAllowedPath(options.sessionFile, "sessionFile");
    const result = await managed.runtime.switchSession(options.sessionFile, { cwdOverride: options.cwdOverride });
    return this.summarizeRuntimeAction(managed, result);
  }

  async forkSession(sessionId: string, options: ForkSessionRequest) {
    if (!options.entryId || typeof options.entryId !== "string") {
      throw new Error("entryId is required");
    }

    const managed = this.getManagedRuntime(sessionId);
    const result = await managed.runtime.fork(options.entryId, { position: options.position });
    return this.summarizeRuntimeAction(managed, result);
  }

  async importSession(sessionId: string, options: ImportSessionRequest) {
    if (!options.path || typeof options.path !== "string") {
      throw new Error("path is required");
    }

    const managed = this.getManagedRuntime(sessionId);
    assertAllowedPath(options.path, "path");
    if (options.cwdOverride) assertAllowedPath(options.cwdOverride, "cwdOverride");
    const result = await managed.runtime.importFromJsonl(options.path, options.cwdOverride);
    return this.summarizeRuntimeAction(managed, result);
  }

  async diagnostics() {
    return buildDiagnostics(await this.modelRuntimePromise, this.workflowService.getBackendInfo(), this.listSessions()[0]?.model);
  }

  async listModels() {
    const modelRuntime = await this.modelRuntimePromise;
    const models = await modelRuntime.getAvailable();
    const configuredProviders = modelRuntime
      .getProviders()
      .filter((provider) => modelRuntime.hasConfiguredAuth(provider.id))
      .map((provider) => provider.id);

    return {
      configuredProviders,
      models: models.map((model) => {
        const metadata = model as { name?: string; label?: string };
        return {
          provider: model.provider,
          id: model.id,
          label: metadata.label ?? metadata.name,
        };
      }),
    };
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
    for (const managed of this.runtimes.values()) {
      await managed.runtime.dispose();
    }
    this.runtimes.clear();
    this.runService.clear();
  }
}

export function getStaticPath(pathname: string) {
  return fileURLToPath(new URL(pathname, import.meta.url));
}
