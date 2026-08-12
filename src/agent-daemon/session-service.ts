import {
  createAgentSessionRuntime,
  SessionManager,
  type AgentSession,
  type EventBusController,
  type ModelRuntime,
  type SessionInfo,
  type SessionTreeNode,
} from "@earendil-works/pi-coding-agent";
import type {
  ForkSessionRequest,
  ImportSessionRequest,
  NewSessionRequest,
  OpenSessionRequest,
  SessionActionResponse,
  SessionSummary,
  SessionTreeEntry,
  StoredSessionSummary,
  SwitchSessionRequest,
  ThinkingLevel,
  UpdateSessionRequest,
} from "@zuu/client";
import { ApiError, notFound } from "../http";
import type { ApprovalRegistry } from "./approval-service";
import { assertAllowedPath, getSessionDir } from "./environment";
import { entryRole, entryText } from "./events";
import type { PackageService } from "./packages";
import type { ProjectService } from "./project-service";
import {
  bindManagedRuntime,
  createManagedSessionManager,
  createZuuRuntimeFactory,
  type CreateSessionOptions,
  type ManagedRuntime,
} from "./session-runtime";

export interface SessionServiceOptions {
  agentDir: string;
  projects: ProjectService;
  packageService: PackageService;
  modelRuntimePromise: Promise<ModelRuntime>;
  approvals: ApprovalRegistry;
  activeRunBySessionId: Map<string, string>;
  approvalWaitBySessionId: Map<string, boolean>;
  eventBus: EventBusController;
  startedAt: string;
}

export class SessionService {
  private readonly runtimes = new Map<string, ManagedRuntime>();

  constructor(private readonly options: SessionServiceOptions) {}

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

    const project = this.options.projects.resolveProject(options);
    const cwd = project.cwd;
    assertAllowedPath(cwd, "cwd");
    const sessionDir = getSessionDir(this.options.agentDir);
    const sessionManager = createManagedSessionManager(options, cwd, sessionDir);
    const runtimeCwd = sessionManager.getCwd();

    const runtimeFactory = createZuuRuntimeFactory(
      {
        packageService: this.options.packageService,
        modelRuntimePromise: this.options.modelRuntimePromise,
        approvals: this.options.approvals,
        activeRunBySessionId: this.options.activeRunBySessionId,
        approvalWaitBySessionId: this.options.approvalWaitBySessionId,
        eventBus: this.options.eventBus,
        startedAt: this.options.startedAt,
        getSessionCount: () => this.runtimes.size,
      },
      options,
    );
    const runtime = await createAgentSessionRuntime(
      runtimeFactory,
      {
        cwd: runtimeCwd,
        agentDir: this.options.agentDir,
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
      notFound(`Unknown session: ${options.sessionId}`, { sessionId: options.sessionId });
    }

    return this.createSession(options);
  }

  listSessions(projectId?: string) {
    if (projectId) this.options.projects.get(projectId);
    return [...this.runtimes.values()]
      .filter((item) => !projectId || item.projectId === projectId)
      .map((item) => this.summarizeSession(item.runtime.session));
  }

  getSession(sessionId: string, projectId?: string) {
    const managed = this.getManagedRuntime(sessionId);
    if (projectId) this.assertSessionProject(managed, sessionId, projectId);
    return this.summarizeSession(managed.runtime.session);
  }

  updateSession(sessionId: string, request: UpdateSessionRequest, projectId?: string) {
    const managed = this.getManagedRuntime(sessionId);
    if (projectId) this.assertSessionProject(managed, sessionId, projectId);
    if (request.name !== undefined) {
      const name = request.name.trim();
      if (name) managed.runtime.session.setSessionName(name);
    }
    if (request.tools !== undefined) {
      managed.runtime.session.setActiveToolsByName(request.tools);
    }
    managed.updatedAt = new Date().toISOString();
    return this.summarizeSession(managed.runtime.session);
  }

  async deleteSession(sessionId: string, projectId?: string) {
    const managed = this.getManagedRuntime(sessionId);
    if (projectId) this.assertSessionProject(managed, sessionId, projectId);
    if (managed.runtime.session.isStreaming) {
      throw new ApiError("Session is running; abort it before deleting", {
        status: 409,
        code: "session_busy",
        details: { sessionId },
      });
    }

    const session = this.summarizeSession(managed.runtime.session);
    await managed.runtime.dispose();
    this.deleteManagedRuntime(managed);
    return session;
  }

  async listStoredSessions(cwd?: string, projectId?: string) {
    const projectCwd = projectId ? this.options.projects.get(projectId).cwd : undefined;
    const targetCwd = cwd ?? projectCwd;
    if (targetCwd) assertAllowedPath(targetCwd, "cwd");
    const sessionDir = getSessionDir(this.options.agentDir);
    const sessions = targetCwd ? await SessionManager.list(targetCwd, sessionDir) : await SessionManager.listAll(sessionDir);
    return sessions
      .map((session) => this.summarizeStoredSession(session, projectId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getProjectId(sessionId: string) {
    return this.getManagedRuntime(sessionId).projectId;
  }

  touchSession(sessionId: string) {
    this.getManagedRuntime(sessionId).updatedAt = new Date().toISOString();
  }

  summarizeSession(session: AgentSession): SessionSummary {
    const managed = this.runtimes.get(session.sessionId);
    return {
      id: session.sessionId,
      projectId: managed?.projectId ?? this.options.projects.get().id,
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

  async abort(sessionId: string) {
    const managed = this.getManagedRuntime(sessionId);
    await managed.runtime.session.abort();
    managed.updatedAt = new Date().toISOString();
    return this.summarizeSession(managed.runtime.session);
  }

  async compact(sessionId: string, instructions?: string) {
    const managed = this.getManagedRuntime(sessionId);
    if (managed.runtime.session.isStreaming) {
      throw new ApiError("Session is running; abort it before compacting", {
        status: 409,
        code: "session_busy",
        details: { sessionId },
      });
    }

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

  async dispose() {
    for (const managed of this.runtimes.values()) {
      await managed.runtime.dispose();
    }
    this.runtimes.clear();
  }

  private findRuntimeBySessionFile(sessionFile: string) {
    return [...this.runtimes.values()].find((managed) => managed.runtime.session.sessionFile === sessionFile);
  }

  private getManagedRuntime(sessionId: string) {
    const managed = this.runtimes.get(sessionId);
    if (!managed) notFound(`Unknown session: ${sessionId}`, { sessionId });
    return managed;
  }

  private assertSessionProject(managed: ManagedRuntime, sessionId: string, projectId: string) {
    this.options.projects.get(projectId);
    if (managed.projectId !== projectId) {
      throw new Error(`Session ${sessionId} does not belong to project ${projectId}`);
    }
  }

  private deleteManagedRuntime(managed: ManagedRuntime) {
    for (const [sessionId, item] of this.runtimes) {
      if (item === managed) this.runtimes.delete(sessionId);
    }
  }

  private summarizeStoredSession(session: SessionInfo, projectId?: string): StoredSessionSummary {
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

  private summarizeRuntimeAction(managed: ManagedRuntime, result: { cancelled: boolean; selectedText?: string }): SessionActionResponse {
    managed.cwd = managed.runtime.cwd;
    managed.updatedAt = new Date().toISOString();
    return {
      session: this.summarizeSession(managed.runtime.session),
      cancelled: result.cancelled,
      selectedText: result.selectedText,
    };
  }
}
