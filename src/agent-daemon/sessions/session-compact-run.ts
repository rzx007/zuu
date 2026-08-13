import { ApiError } from "../../server";
import type { RunService } from "../runs/run-service";
import type { SessionService } from "./session-service";

export async function compactSessionWithRun(
  sessions: SessionService,
  runs: RunService,
  sessionId: string,
  instructions?: string,
) {
  const initialSession = sessions.getSession(sessionId);
  if (initialSession.isStreaming) {
    throw new ApiError("Session is running; abort it before compacting", {
      status: 409,
      code: "session_busy",
      details: { sessionId },
    });
  }

  const run = runs.startRun({
    sessionId,
    projectId: initialSession.projectId,
    request: { prompt: "Compact session", source: "api" },
  });
  const record = runs.createEventRecorder(run.id);
  record({ runId: run.id, type: "session", session: initialSession, run });
  record({ runId: run.id, type: "agent_event", eventType: "compaction_start", run });

  try {
    const session = await sessions.compact(sessionId, instructions);
    run.status = "completed";
    run.finishedAt = new Date().toISOString();
    runs.saveRun(run);
    record({ runId: run.id, type: "agent_event", eventType: "compaction_end", session, run });
    record({ runId: run.id, type: "done", session, run });
    return session;
  } catch (error) {
    run.status = "failed";
    run.finishedAt = new Date().toISOString();
    run.error = error instanceof Error ? error.message : String(error);
    runs.saveRun(run);
    record({ runId: run.id, type: "error", message: run.error, run });
    throw error;
  }
}
