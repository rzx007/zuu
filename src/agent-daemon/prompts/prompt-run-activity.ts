import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { PromptRequest } from "@zuu/client";
import type { RunService } from "../runs/run-service";
import type { SessionService } from "../sessions/session-service";

export interface PromptRunActivityOptions {
  request: PromptRequest;
  session: AgentSession;
  sessions: SessionService;
  runs: RunService;
  activeRunBySessionId: Map<string, string>;
  approvalWaitBySessionId: Map<string, boolean>;
}

export function startPromptRunActivity(options: PromptRunActivityOptions) {
  const run = options.runs.startRun({
    sessionId: options.session.sessionId,
    projectId: options.sessions.getProjectId(options.session.sessionId),
    request: options.request,
  });
  const runId = run.id;
  options.activeRunBySessionId.set(options.session.sessionId, runId);
  options.approvalWaitBySessionId.set(options.session.sessionId, options.request.source !== "schedule");

  return {
    run,
    runId,
    recordAndPublish: options.runs.createEventRecorder(runId),
    release: () => {
      if (options.activeRunBySessionId.get(options.session.sessionId) === runId) {
        options.activeRunBySessionId.delete(options.session.sessionId);
      }
      options.approvalWaitBySessionId.delete(options.session.sessionId);
    },
  };
}
