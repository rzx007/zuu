import type {
  CreateSessionRequest,
  ForkSessionRequest,
  ImportSessionRequest,
  NewSessionRequest,
  OpenSessionRequest,
  SwitchSessionRequest,
  UpdateSessionRequest,
} from "@zuu/client";
import type { RunService } from "../runs/run-service";
import { compactSessionWithRun } from "../sessions/session-compact-run";
import type { SessionService } from "../sessions/session-service";

export class SessionApiService {
  constructor(
    private readonly sessions: SessionService,
    private readonly runs: RunService,
  ) {}

  createSession(options: CreateSessionRequest = {}) {
    return this.sessions.createSession(options);
  }

  openSession(options: OpenSessionRequest) {
    return this.sessions.openSession(options);
  }

  listSessions(projectId?: string) {
    return this.sessions.listSessions(projectId);
  }

  getSession(sessionId: string, projectId?: string) {
    return this.sessions.getSession(sessionId, projectId);
  }

  updateSession(sessionId: string, request: UpdateSessionRequest, projectId?: string) {
    return this.sessions.updateSession(sessionId, request, projectId);
  }

  deleteSession(sessionId: string, projectId?: string) {
    return this.sessions.deleteSession(sessionId, projectId);
  }

  listStoredSessions(cwd?: string, projectId?: string) {
    return this.sessions.listStoredSessions(cwd, projectId);
  }

  summarizeSessionTree(sessionId: string) {
    return this.sessions.summarizeSessionTree(sessionId);
  }

  summarizeSession(session: Parameters<SessionService["summarizeSession"]>[0]) {
    return this.sessions.summarizeSession(session);
  }

  async abortSession(sessionId: string) {
    const session = await this.sessions.abort(sessionId);
    this.runs.abortSessionRuns(sessionId);
    return session;
  }

  async compactSession(sessionId: string, instructions?: string) {
    return compactSessionWithRun(this.sessions, this.runs, sessionId, instructions);
  }

  newSession(sessionId: string, options: NewSessionRequest = {}) {
    return this.sessions.newSession(sessionId, options);
  }

  switchSession(sessionId: string, options: SwitchSessionRequest) {
    return this.sessions.switchSession(sessionId, options);
  }

  forkSession(sessionId: string, options: ForkSessionRequest) {
    return this.sessions.forkSession(sessionId, options);
  }

  importSession(sessionId: string, options: ImportSessionRequest) {
    return this.sessions.importSession(sessionId, options);
  }
}
