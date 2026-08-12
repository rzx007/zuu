import type {
  CreateSessionRequest,
  ForkSessionRequest,
  ImportSessionRequest,
  NewSessionRequest,
  OpenSessionRequest,
  SwitchSessionRequest,
  UpdateSessionRequest,
} from "@zuu/client";
import { ApiError } from "../http";
import type { RunService } from "./run-service";
import type { SessionService } from "./session-service";

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
    const initialSession = this.sessions.getSession(sessionId);
    if (initialSession.isStreaming) {
      throw new ApiError("Session is running; abort it before compacting", {
        status: 409,
        code: "session_busy",
        details: { sessionId },
      });
    }

    const run = this.runs.startRun({
      sessionId,
      projectId: initialSession.projectId,
      request: { prompt: "Compact session", source: "api" },
    });
    const record = this.runs.createEventRecorder(run.id);
    record({ runId: run.id, type: "session", session: initialSession, run });
    record({ runId: run.id, type: "agent_event", eventType: "compaction_start", run });

    try {
      const session = await this.sessions.compact(sessionId, instructions);
      run.status = "completed";
      run.finishedAt = new Date().toISOString();
      this.runs.saveRun(run);
      record({ runId: run.id, type: "agent_event", eventType: "compaction_end", session, run });
      record({ runId: run.id, type: "done", session, run });
      return session;
    } catch (error) {
      run.status = "failed";
      run.finishedAt = new Date().toISOString();
      run.error = error instanceof Error ? error.message : String(error);
      this.runs.saveRun(run);
      record({ runId: run.id, type: "error", message: run.error, run });
      throw error;
    }
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
