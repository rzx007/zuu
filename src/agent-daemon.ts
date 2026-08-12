import { fileURLToPath } from "node:url";
import {
  createEventBus,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  SessionManager,
  type AgentSession,
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  type DefaultResourceLoader,
  type EventBusController,
  type SessionInfo,
  type SessionTreeNode,
} from "@earendil-works/pi-coding-agent";
import {
  assertAllowedPath,
  createModelRuntime,
  DEFAULT_READ_ONLY_TOOLS,
  getApprovalStorePath,
  getPackageOperationStorePath,
  getPackageTrustStorePath,
  getProjectStorePath,
  getRunEventStorePath,
  getRunStorePath,
  getScheduleStorePath,
  getSessionDir,
  getWorkflowStorePath,
  getZuuAgentDir,
} from "./agent-daemon/environment";
import { ApprovalStore, assertApprovalStatus } from "./agent-daemon/approval-store";
import { createApprovalExtension, subscribeApprovalEvents } from "./agent-daemon/approval-policy";
import { buildDiagnostics } from "./agent-daemon/diagnostics";
import { compactAgentEvent, entryRole, entryText } from "./agent-daemon/events";
import { ProjectStore } from "./agent-daemon/projects";
import { ScheduleStore } from "./agent-daemon/schedules";
import { PackageService } from "./agent-daemon/packages";
import { createStatusTool } from "./agent-daemon/status-tool";
import { createWorkflowBackend } from "./agent-daemon/workflows";
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
  ProjectSummary,
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
import { loadRunHistory, saveRunHistory } from "./agent-daemon/run-history";
import { matchesEventQuery, RunEventStore, type RunEventDraft } from "./agent-daemon/run-events";

interface ManagedRuntime {
  runtime: AgentSessionRuntime;
  projectId: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
}

type CreateSessionOptions = CreateSessionRequest;

type EventListener = (event: PromptStreamEvent) => void;


export class ZuuDaemon {
  private readonly runtimes = new Map<string, ManagedRuntime>();
  private readonly agentDir = getZuuAgentDir();
  private readonly runStorePath = getRunStorePath(this.agentDir);
  private readonly runEventStore = new RunEventStore(getRunEventStorePath(this.agentDir));
  private readonly eventListeners = new Set<EventListener>();
  private readonly projectStore = new ProjectStore(getProjectStorePath(this.agentDir), this.agentDir);
  private readonly approvalStore = new ApprovalStore(getApprovalStorePath(this.agentDir));
  private readonly activeRunBySessionId = new Map<string, string>();
  private readonly eventBus: EventBusController = createEventBus();
  private readonly runs = new Map<string, RunSummary>(
    loadRunHistory(this.runStorePath).map((run) => [run.id, run]),
  );
  private readonly packageService = new PackageService(
    process.cwd(),
    this.agentDir,
    getPackageOperationStorePath(this.agentDir),
    getPackageTrustStorePath(this.agentDir),
  );
  private readonly modelRuntimePromise = createModelRuntime();
  private readonly startedAt = new Date().toISOString();
  private readonly scheduleStore = new ScheduleStore(getScheduleStorePath(this.agentDir), {
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
  });

  private createRuntimeFactory(options: CreateSessionOptions): CreateAgentSessionRuntimeFactory {
    return async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
      const settingsManager = this.packageService.createTrustedSettingsManager(cwd);
      const modelRuntime = await this.modelRuntimePromise;
      const services = await createAgentSessionServices({
        cwd,
        agentDir,
        modelRuntime,
        settingsManager,
        resourceLoaderOptions: {
          eventBus: this.eventBus,
          extensionFactories: [
            createApprovalExtension({
              approvalStore: this.approvalStore,
              getActiveRunId: (sessionId) => this.activeRunBySessionId.get(sessionId),
            }),
          ],
          appendSystemPrompt: [
            "You are running inside Zuu, a small daemon-hosted Pi SDK agent app.",
            "Be explicit about files changed, commands run, and assumptions.",
          ],
        },
      });
      const model = options.model ? modelRuntime.getModel(options.model.provider, options.model.id) : undefined;
      const statusTool = createStatusTool({
        cwd,
        startedAt: this.startedAt,
        getSessionCount: () => this.runtimes.size,
        settingsManager,
        resourceLoader: services.resourceLoader as DefaultResourceLoader,
      });
      const result = await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        model,
        thinkingLevel: options.thinkingLevel,
        customTools: [statusTool],
        tools: options.tools ?? DEFAULT_READ_ONLY_TOOLS,
      });

      return {
        ...result,
        services,
        diagnostics: services.diagnostics,
      };
    };
  }

  private bindRuntime(managed: ManagedRuntime) {
    managed.runtime.setRebindSession(async (session) => {
      for (const [sessionId, item] of this.runtimes) {
        if (item === managed && sessionId !== session.sessionId) {
          this.runtimes.delete(sessionId);
        }
      }
      managed.cwd = managed.runtime.cwd;
      managed.updatedAt = new Date().toISOString();
      this.runtimes.set(session.sessionId, managed);
    });
  }

  listProjects() {
    return this.projectStore.list();
  }

  getProject(projectId: string) {
    return this.projectStore.get(projectId);
  }

  createProject(request: CreateProjectRequest) {
    return this.projectStore.create(request);
  }

  updateProject(projectId: string, request: UpdateProjectRequest) {
    return this.projectStore.update(projectId, request);
  }

  deleteProject(projectId: string) {
    return this.projectStore.delete(projectId);
  }

  private resolveProject(options: { projectId?: string; cwd?: string }): ProjectSummary {
    if (options.projectId) return this.projectStore.get(options.projectId);
    if (!options.cwd) return this.projectStore.get();

    return this.projectStore.findByCwd(options.cwd) ?? this.projectStore.create({ cwd: options.cwd });
  }

  private createSessionManager(options: CreateSessionOptions, cwd: string, sessionDir: string) {
    assertAllowedPath(cwd, "cwd");
    if (options.sessionFile) {
      assertAllowedPath(options.sessionFile, "sessionFile");
      return SessionManager.open(options.sessionFile, sessionDir, cwd);
    }

    if (options.continueRecent) {
      return SessionManager.continueRecent(cwd, sessionDir);
    }

    return options.persist === false ? SessionManager.inMemory(cwd) : SessionManager.create(cwd, sessionDir);
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

    const project = this.resolveProject(options);
    const cwd = project.cwd;
    assertAllowedPath(cwd, "cwd");
    const agentDir = getZuuAgentDir();
    const sessionDir = getSessionDir(agentDir);
    const sessionManager = this.createSessionManager(options, cwd, sessionDir);
    const runtimeCwd = sessionManager.getCwd();

    const runtime = await createAgentSessionRuntime(this.createRuntimeFactory(options), {
      cwd: runtimeCwd,
      agentDir,
      sessionManager,
    });
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
    this.bindRuntime(managed);
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
    if (projectId) this.projectStore.get(projectId);
    return [...this.runtimes.values()]
      .filter((item) => !projectId || item.projectId === projectId)
      .map((item) => this.summarizeSession(item.runtime.session));
  }

  async listStoredSessions(cwd?: string, projectId?: string) {
    const projectCwd = projectId ? this.projectStore.get(projectId).cwd : undefined;
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
    return [...this.runs.values()]
      .filter((run) => !sessionId || run.sessionId === sessionId)
      .filter((run) => !projectId || run.projectId === projectId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  private persistRuns() {
    saveRunHistory(this.runStorePath, this.listRuns());
  }

  private setRun(run: RunSummary) {
    this.runs.set(run.id, run);
    this.persistRuns();
  }

  getRun(runId: string, projectId?: string) {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    if (projectId && run.projectId !== projectId) throw new Error(`Unknown run: ${runId}`);
    return run;
  }

  listRunEvents(runId: string, afterEventId?: string, projectId?: string) {
    this.getRun(runId, projectId);
    return this.runEventStore.list(runId, afterEventId);
  }

  listEvents(query: EventStreamQuery = {}) {
    if (query.runId) this.getRun(query.runId);
    return this.runEventStore.listAll(query);
  }

  subscribeEvents(query: EventStreamQuery, listener: EventListener) {
    const filteredListener = (event: PromptStreamEvent) => {
      if (matchesEventQuery(event, query)) listener(event);
    };
    this.eventListeners.add(filteredListener);
    return () => this.eventListeners.delete(filteredListener);
  }

  private publishEvent(event: PromptStreamEvent) {
    for (const listener of this.eventListeners) {
      listener(event);
    }
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

  private createWorkflowBackend() {
    return createWorkflowBackend({
      path: getWorkflowStorePath(this.agentDir),
      packages: this.packageService.listTrustedPackageSources(),
      requestedKind: process.env.ZUU_WORKFLOW_BACKEND,
      agentDir: this.agentDir,
      launchPrompt: (request) => this.launchWorkflowPrompt(request),
    });
  }

  listWorkflows(projectId?: string) {
    if (projectId) this.projectStore.get(projectId);
    const backend = this.createWorkflowBackend();
    return backend.listDefinitions().then((workflows) => ({ workflows, backend: backend.getInfo() }));
  }

  startWorkflow(workflowId: string, request: StartWorkflowRequest = {}, projectId?: string) {
    return this.createWorkflowBackend().start(workflowId, {
      ...request,
      projectId: this.projectStore.get(projectId ?? request.projectId).id,
    });
  }

  async listWorkflowRuns(projectId?: string) {
    if (projectId) this.projectStore.get(projectId);
    const runs = await this.createWorkflowBackend().listRuns();
    return runs.filter((run) => !projectId || run.projectId === projectId);
  }

  async getWorkflowRun(runId: string, projectId?: string) {
    if (projectId) this.projectStore.get(projectId);
    const run = await this.createWorkflowBackend().getRun(runId);
    if (projectId && run.projectId !== projectId) throw new Error(`Unknown workflow run: ${runId}`);
    return run;
  }

  async abortWorkflowRun(runId: string, projectId?: string) {
    await this.getWorkflowRun(runId, projectId);
    return this.createWorkflowBackend().abort(runId);
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
    if (projectId) this.projectStore.get(projectId);
    return this.scheduleStore.list(projectId);
  }

  createSchedule(request: CreateScheduleRequest, projectIdOverride?: string) {
    const projectId = this.projectStore.get(projectIdOverride ?? request.action.projectId).id;
    return this.scheduleStore.create({
      ...request,
      action: {
        ...request.action,
        projectId,
      },
    });
  }

  getSchedule(scheduleId: string, projectId?: string) {
    if (projectId) this.projectStore.get(projectId);
    const schedule = this.scheduleStore.get(scheduleId);
    if (projectId && schedule.action.projectId !== projectId) throw new Error(`Unknown schedule: ${scheduleId}`);
    return schedule;
  }

  pauseSchedule(scheduleId: string, projectId?: string) {
    this.getSchedule(scheduleId, projectId);
    return this.scheduleStore.pause(scheduleId);
  }

  resumeSchedule(scheduleId: string, projectId?: string) {
    this.getSchedule(scheduleId, projectId);
    return this.scheduleStore.resume(scheduleId);
  }

  triggerSchedule(scheduleId: string, projectId?: string) {
    this.getSchedule(scheduleId, projectId);
    return this.scheduleStore.trigger(scheduleId);
  }

  deleteSchedule(scheduleId: string, projectId?: string) {
    this.getSchedule(scheduleId, projectId);
    return this.scheduleStore.delete(scheduleId);
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
      projectId: managed?.projectId ?? this.projectStore.get().id,
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
    const runId = crypto.randomUUID();
    const session = await this.getOrCreateSession(request);
    const managed = this.runtimes.get(session.sessionId);
    if (managed) managed.updatedAt = new Date().toISOString();

    if (request.tools) {
      session.setActiveToolsByName(request.tools);
    }

    const run: RunSummary = {
      id: runId,
      sessionId: session.sessionId,
      projectId: this.getManagedRuntime(session.sessionId).projectId,
      status: "running",
      prompt: request.prompt,
      startedAt: new Date().toISOString(),
    };
    this.setRun(run);
    this.activeRunBySessionId.set(session.sessionId, runId);
    const recordEvent = this.runEventStore.createRecorder(runId);
    const recordAndPublish = (event: RunEventDraft) => {
      const recorded = recordEvent(event);
      this.publishEvent(recorded);
      return recorded;
    };

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
        this.persistRuns();
        yield recordAndPublish({ runId, type: "error", message, run });
        return;
      }

      if (managed) managed.updatedAt = new Date().toISOString();
      run.status = run.status === "aborted" ? "aborted" : sawError ? "error" : "done";
      run.endedAt = new Date().toISOString();
      this.persistRuns();
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
    const endedAt = new Date().toISOString();
    for (const run of this.runs.values()) {
      if (run.sessionId === sessionId && run.status === "running") {
        run.status = "aborted";
        run.endedAt = endedAt;
      }
    }
    this.persistRuns();
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
    return buildDiagnostics(await this.modelRuntimePromise, this.createWorkflowBackend().getInfo(), this.listSessions()[0]?.model);
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
    this.scheduleStore.dispose();
    for (const managed of this.runtimes.values()) {
      await managed.runtime.dispose();
    }
    this.runtimes.clear();
    this.runs.clear();
  }
}

export function getStaticPath(pathname: string) {
  return fileURLToPath(new URL(pathname, import.meta.url));
}
