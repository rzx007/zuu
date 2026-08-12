import { fileURLToPath } from "node:url";
import {
  createEventBus,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  SessionManager,
  SettingsManager,
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
  getRunStorePath,
  getScheduleStorePath,
  getSessionDir,
  getWorkflowStorePath,
  getZuuAgentDir,
  normalizePackageSource,
  packageSourceToString,
} from "./agent-daemon/environment";
import { ApprovalStore, assertApprovalStatus } from "./agent-daemon/approval-store";
import { createApprovalExtension, subscribeApprovalEvents } from "./agent-daemon/approval-policy";
import { buildDiagnostics } from "./agent-daemon/diagnostics";
import { compactAgentEvent, entryRole, entryText } from "./agent-daemon/events";
import { ScheduleStore } from "./agent-daemon/schedules";
import { createStatusTool } from "./agent-daemon/status-tool";
import { createWorkflowBackend } from "./agent-daemon/workflows";
import type {
  CreateScheduleRequest,
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
} from "@zuu/client";
import { loadRunHistory, saveRunHistory } from "./agent-daemon/run-history";

interface ManagedRuntime {
  runtime: AgentSessionRuntime;
  cwd: string;
  createdAt: string;
  updatedAt: string;
}

interface CreateSessionOptions {
  cwd?: string;
  name?: string;
  sessionFile?: string;
  continueRecent?: boolean;
  model?: PromptRequest["model"];
  thinkingLevel?: ThinkingLevel;
  tools?: string[];
  persist?: boolean;
}


export class ZuuDaemon {
  private readonly runtimes = new Map<string, ManagedRuntime>();
  private readonly agentDir = getZuuAgentDir();
  private readonly runStorePath = getRunStorePath(this.agentDir);
  private readonly approvalStore = new ApprovalStore(getApprovalStorePath(this.agentDir));
  private readonly activeRunBySessionId = new Map<string, string>();
  private readonly eventBus: EventBusController = createEventBus();
  private readonly runs = new Map<string, RunSummary>(
    loadRunHistory(this.runStorePath).map((run) => [run.id, run]),
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
      const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
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

  private createSessionManager(options: CreateSessionOptions, cwd: string, sessionDir: string) {
    assertAllowedPath(cwd, "cwd");
    if (options.sessionFile) {
      assertAllowedPath(options.sessionFile, "sessionFile");
      return SessionManager.open(options.sessionFile, sessionDir, options.cwd);
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
      if (existing) return existing.runtime.session;
    }

    const cwd = options.cwd ?? process.cwd();
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
    const managed: ManagedRuntime = { runtime, cwd: runtime.cwd, createdAt: now, updatedAt: now };
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
      cwd: options.cwdOverride,
      sessionFile: options.sessionFile,
    });
  }

  async getOrCreateSession(options: CreateSessionOptions & { sessionId?: string }) {
    if (options.sessionId) {
      const existing = this.runtimes.get(options.sessionId);
      if (existing) return existing.runtime.session;
      throw new Error(`Unknown session: ${options.sessionId}`);
    }

    return this.createSession(options);
  }

  listSessions() {
    return [...this.runtimes.values()].map((item) => this.summarizeSession(item.runtime.session));
  }

  async listStoredSessions(cwd?: string) {
    if (cwd) assertAllowedPath(cwd, "cwd");
    const agentDir = getZuuAgentDir();
    const sessionDir = getSessionDir(agentDir);
    const sessions = cwd ? await SessionManager.list(cwd, sessionDir) : await SessionManager.listAll(sessionDir);
    return sessions
      .map((session) => this.summarizeStoredSession(session))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  listRuns(sessionId?: string) {
    return [...this.runs.values()]
      .filter((run) => !sessionId || run.sessionId === sessionId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  private persistRuns() {
    saveRunHistory(this.runStorePath, this.listRuns());
  }

  private setRun(run: RunSummary) {
    this.runs.set(run.id, run);
    this.persistRuns();
  }

  getRun(runId: string) {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    return run;
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
      packages: this.listPackages(),
      requestedKind: process.env.ZUU_WORKFLOW_BACKEND,
    });
  }

  listWorkflows() {
    const backend = this.createWorkflowBackend();
    return backend.listDefinitions().then((workflows) => ({ workflows, backend: backend.getInfo() }));
  }

  startWorkflow(workflowId: string, request: StartWorkflowRequest = {}) {
    return this.createWorkflowBackend().start(workflowId, request);
  }

  listWorkflowRuns() {
    return this.createWorkflowBackend().listRuns();
  }

  getWorkflowRun(runId: string) {
    return this.createWorkflowBackend().getRun(runId);
  }

  abortWorkflowRun(runId: string) {
    return this.createWorkflowBackend().abort(runId);
  }

  listSchedules() {
    return this.scheduleStore.list();
  }

  createSchedule(request: CreateScheduleRequest) {
    return this.scheduleStore.create(request);
  }

  getSchedule(scheduleId: string) {
    return this.scheduleStore.get(scheduleId);
  }

  pauseSchedule(scheduleId: string) {
    return this.scheduleStore.pause(scheduleId);
  }

  resumeSchedule(scheduleId: string) {
    return this.scheduleStore.resume(scheduleId);
  }

  triggerSchedule(scheduleId: string) {
    return this.scheduleStore.trigger(scheduleId);
  }

  deleteSchedule(scheduleId: string) {
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

  summarizeStoredSession(session: SessionInfo): StoredSessionSummary {
    return {
      id: session.id,
      path: session.path,
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
      status: "running",
      prompt: request.prompt,
      startedAt: new Date().toISOString(),
    };
    this.setRun(run);
    this.activeRunBySessionId.set(session.sessionId, runId);

    yield { runId, type: "session", session: this.summarizeSession(session), run };

    const queue: PromptStreamEvent[] = [];
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
          yield next;
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
        yield { runId, type: "error", message, run };
        return;
      }

      if (managed) managed.updatedAt = new Date().toISOString();
      run.status = run.status === "aborted" ? "aborted" : sawError ? "error" : "done";
      run.endedAt = new Date().toISOString();
      this.persistRuns();
      yield { runId, type: "done", session: this.summarizeSession(session), run };
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

  private createSettingsManager(cwd = process.cwd()) {
    return SettingsManager.create(cwd, getZuuAgentDir(), { projectTrusted: true });
  }

  listPackages() {
    return this.createSettingsManager().getPackages().map(packageSourceToString);
  }

  async addPackage(request: PackageMutationRequest) {
    const source = normalizePackageSource(request.source);
    const settingsManager = this.createSettingsManager();
    const packages = settingsManager.getPackages().map(packageSourceToString);
    if (!packages.includes(source)) {
      settingsManager.setPackages([...packages, source]);
      await settingsManager.flush();
    }
    return settingsManager.getPackages().map(packageSourceToString);
  }

  async removePackage(request: PackageMutationRequest) {
    const source = normalizePackageSource(request.source);
    const settingsManager = this.createSettingsManager();
    const packages = settingsManager.getPackages().map(packageSourceToString);
    settingsManager.setPackages(packages.filter((item) => item !== source));
    await settingsManager.flush();
    return settingsManager.getPackages().map(packageSourceToString);
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
