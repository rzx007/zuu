import type { EventStreamQuery, PromptStreamEvent } from "@zuu/client";
import { ApiError } from "../../http";
import type { RunService } from "../runs/run-service";
import type { SessionService } from "../sessions/session-service";

export class RunApiService {
  constructor(
    private readonly runs: RunService,
    private readonly sessions: Pick<SessionService, "abort">,
  ) {}

  listRuns(sessionId?: string, projectId?: string) {
    return this.runs.listRuns(sessionId, projectId);
  }

  getRun(runId: string, projectId?: string) {
    return this.runs.getRun(runId, projectId);
  }

  async abortRun(runId: string, projectId?: string) {
    const run = this.runs.getRun(runId, projectId);
    if (run.status !== "running" && run.status !== "waiting_approval") {
      throw new ApiError("Run is not active", {
        status: 409,
        code: "run_not_active",
        details: { runId, status: run.status },
      });
    }
    await this.sessions.abort(run.sessionId);
    run.status = "aborted";
    run.finishedAt = new Date().toISOString();
    this.runs.saveRun(run);
    return run;
  }

  listRunEvents(runId: string, afterEventId?: string, projectId?: string) {
    return this.runs.listRunEvents(runId, afterEventId, projectId);
  }

  listEvents(query: EventStreamQuery = {}) {
    return this.runs.listEvents(query);
  }

  subscribeEvents(query: EventStreamQuery, listener: (event: PromptStreamEvent) => void) {
    return this.runs.subscribeEvents(query, listener);
  }
}
