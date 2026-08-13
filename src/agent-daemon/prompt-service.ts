import type { EventBus } from "@earendil-works/pi-coding-agent";
import type { PromptRequest, PromptStreamEvent } from "@zuu/client";
import { ApiError } from "../http";
import { subscribeApprovalEvents } from "./approval-events";
import { compactAgentEvent } from "./events";
import { PromptEventQueue } from "./prompt-event-queue";
import { startPromptRunActivity } from "./prompt-run-activity";
import { completePromptRun, failPromptRun } from "./prompt-run-finalization";
import type { RunService } from "./run-service";
import type { SessionService } from "./session-service";

interface PromptServiceOptions {
  sessions: SessionService;
  runs: RunService;
  eventBus: EventBus;
  activeRunBySessionId: Map<string, string>;
  approvalWaitBySessionId: Map<string, boolean>;
}

export class PromptService {
  constructor(private readonly options: PromptServiceOptions) {}

  async *prompt(request: PromptRequest): AsyncGenerator<PromptStreamEvent> {
    const session = await this.options.sessions.getOrCreateSession(request);
    this.options.sessions.touchSession(session.sessionId);
    if (session.isStreaming && !request.streamingBehavior) {
      throw new ApiError("Session is already running; use steer or followUp", {
        status: 409,
        code: "session_busy",
        details: { sessionId: session.sessionId },
      });
    }

    if (request.tools) {
      session.setActiveToolsByName(request.tools);
    }

    const activity = startPromptRunActivity({
      request,
      session,
      sessions: this.options.sessions,
      runs: this.options.runs,
      activeRunBySessionId: this.options.activeRunBySessionId,
      approvalWaitBySessionId: this.options.approvalWaitBySessionId,
    });
    const { run, runId, recordAndPublish } = activity;

    yield recordAndPublish({
      runId,
      type: "session",
      session: this.options.sessions.summarizeSession(session),
      run,
    });

    const queue = new PromptEventQueue();
    let sawError = false;
    let streamErrorMessage: string | undefined;

    const unsubscribe = session.subscribe((event) => {
      const compact = compactAgentEvent(event, runId);
      if (compact) {
        if (compact.type === "error") {
          sawError = true;
          streamErrorMessage ??= compact.message;
        }
        queue.push(compact);
      }
    });
    const unsubscribeApprovalEvents = subscribeApprovalEvents(this.options.eventBus, runId, (event) => {
      if (event.type === "approval_requested" && run.status === "running") {
        run.status = "waiting_approval";
        this.options.runs.saveRun(run);
      } else if (event.type === "approval_resolved" && run.status === "waiting_approval") {
        run.status = "running";
        this.options.runs.saveRun(run);
      }
      queue.push(event);
    });

    session
      .prompt(request.prompt, { streamingBehavior: request.streamingBehavior })
      .then(() => queue.finish())
      .catch((error) => queue.finish(error));

    try {
      for (;;) {
        const next = await queue.next();
        if (!next) break;
        yield recordAndPublish(next);
      }

      if (queue.error) {
        yield recordAndPublish(failPromptRun(run, queue.error, (next) => this.options.runs.saveRun(next)));
        return;
      }

      this.options.sessions.touchSession(session.sessionId);
      yield recordAndPublish({
        ...completePromptRun(run, { sawError, streamErrorMessage }, (next) => this.options.runs.saveRun(next)),
        session: this.options.sessions.summarizeSession(session),
      });
    } finally {
      activity.release();
      unsubscribeApprovalEvents();
      unsubscribe();
    }
  }
}
