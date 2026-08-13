import {
  type AgentSession,
  type EventBusController,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type {
  ForkSessionRequest,
  ImportSessionRequest,
  NewSessionRequest,
  OpenSessionRequest,
  SessionSummary,
  SwitchSessionRequest,
  UpdateSessionRequest,
} from "@zuu/client";
import { notFound, validationError } from "../http";
import type { ApprovalRegistry } from "./approval-service";
import type { PackageService } from "./packages";
import type { ProjectService } from "./project-service";
import {
  applySessionUpdate,
  forkManagedSession,
  importManagedSession,
  newManagedSession,
  switchManagedSession,
} from "./session-actions";
import { createSessionRuntime } from "./session-factory";
import { listStoredSessionSummaries } from "./session-files";
import {
  abortManagedSession,
  compactManagedSession,
  deleteManagedSession,
} from "./session-lifecycle";
import { SessionRuntimeRegistry } from "./session-registry";
import { getManagedRuntimeForProject } from "./session-runtime-access";
import {
  type CreateSessionOptions,
  type ManagedRuntime,
} from "./session-runtime";
import {
  summarizeAgentSession,
  summarizeSessionTree,
} from "./session-summary";

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
  private readonly runtimes = new SessionRuntimeRegistry();

  constructor(private readonly options: SessionServiceOptions) {}

  async createSession(options: CreateSessionOptions = {}) {
    return createSessionRuntime(options, {
      ...this.options,
      runtimes: this.runtimes,
    });
  }

  async openSession(options: OpenSessionRequest) {
    if (!options.sessionFile || typeof options.sessionFile !== "string") {
      validationError("sessionFile is required", { field: "sessionFile" });
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
          notFound(`Unknown session: ${options.sessionId}`, { sessionId: options.sessionId, projectId: options.projectId });
        }
        return existing.runtime.session;
      }
      notFound(`Unknown session: ${options.sessionId}`, { sessionId: options.sessionId });
    }

    return this.createSession(options);
  }

  listSessions(projectId?: string) {
    if (projectId) this.options.projects.get(projectId);
    return this.runtimes
      .list(projectId)
      .map((item) => this.summarizeSession(item.runtime.session));
  }

  getSession(sessionId: string, projectId?: string) {
    const managed = this.getManagedRuntime(sessionId, projectId);
    return this.summarizeSession(managed.runtime.session);
  }

  updateSession(sessionId: string, request: UpdateSessionRequest, projectId?: string) {
    const managed = this.getManagedRuntime(sessionId, projectId);
    applySessionUpdate(managed, request);
    return this.summarizeSession(managed.runtime.session);
  }

  async deleteSession(sessionId: string, projectId?: string) {
    const managed = this.getManagedRuntime(sessionId, projectId);
    return deleteManagedSession(
      managed,
      sessionId,
      (item) => this.summarizeSession(item.runtime.session),
      (item) => this.deleteManagedRuntime(item),
    );
  }

  async listStoredSessions(cwd?: string, projectId?: string) {
    return listStoredSessionSummaries({
      agentDir: this.options.agentDir,
      projects: this.options.projects,
      runtimes: this.runtimes,
      cwd,
      projectId,
    });
  }

  getProjectId(sessionId: string) {
    return this.getManagedRuntime(sessionId).projectId;
  }

  touchSession(sessionId: string) {
    this.runtimes.touch(sessionId);
  }

  summarizeSession(session: AgentSession): SessionSummary {
    return summarizeAgentSession(session, this.sessionSummaryContext(session));
  }

  summarizeSessionTree(sessionId: string) {
    const managed = this.getManagedRuntime(sessionId);
    return summarizeSessionTree(managed.runtime.session.sessionManager.getTree());
  }

  async abort(sessionId: string) {
    const managed = this.getManagedRuntime(sessionId);
    return abortManagedSession(managed, (item) => this.summarizeSession(item.runtime.session));
  }

  async compact(sessionId: string, instructions?: string) {
    const managed = this.getManagedRuntime(sessionId);
    return compactManagedSession(managed, sessionId, instructions, (item) => this.summarizeSession(item.runtime.session));
  }

  async newSession(sessionId: string, options: NewSessionRequest = {}) {
    const managed = this.getManagedRuntime(sessionId);
    return newManagedSession(managed, options, (item) => this.summarizeSession(item.runtime.session));
  }

  async switchSession(sessionId: string, options: SwitchSessionRequest) {
    const managed = this.getManagedRuntime(sessionId);
    return switchManagedSession(managed, options, (item) => this.summarizeSession(item.runtime.session));
  }

  async forkSession(sessionId: string, options: ForkSessionRequest) {
    const managed = this.getManagedRuntime(sessionId);
    return forkManagedSession(managed, options, (item) => this.summarizeSession(item.runtime.session));
  }

  async importSession(sessionId: string, options: ImportSessionRequest) {
    const managed = this.getManagedRuntime(sessionId);
    return importManagedSession(managed, options, (item) => this.summarizeSession(item.runtime.session));
  }

  async dispose() {
    await this.runtimes.dispose();
  }

  private getManagedRuntime(sessionId: string, projectId?: string) {
    return getManagedRuntimeForProject(this.runtimes, this.options.projects, sessionId, projectId);
  }

  private deleteManagedRuntime(managed: ManagedRuntime) {
    this.runtimes.delete(managed);
  }

  private sessionSummaryContext(session: AgentSession) {
    return this.runtimes.summaryContext(session, {
      projectId: this.options.projects.get().id,
      cwd: process.cwd(),
    });
  }
}
