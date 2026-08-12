import type { EventBus } from "@earendil-works/pi-coding-agent";
import type { PromptRequest, PromptStreamEvent } from "@zuu/client";
import { subscribeApprovalEvents } from "./approval-policy";
import { compactAgentEvent } from "./events";
import type { RunEventDraft } from "./run-events";
import type { RunService } from "./run-service";
import type { SessionService } from "./session-service";

interface PromptServiceOptions {
  sessions: SessionService;
  runs: RunService;
  eventBus: EventBus;
  activeRunBySessionId: Map<string, string>;
}

export class PromptService {
  constructor(private readonly options: PromptServiceOptions) {}

  async *prompt(request: PromptRequest): AsyncGenerator<PromptStreamEvent> {
    const session = await this.options.sessions.getOrCreateSession(request);
    this.options.sessions.touchSession(session.sessionId);

    if (request.tools) {
      session.setActiveToolsByName(request.tools);
    }

    const run = this.options.runs.startRun({
      sessionId: session.sessionId,
      projectId: this.options.sessions.getProjectId(session.sessionId),
      request,
    });
    const runId = run.id;
    this.options.activeRunBySessionId.set(session.sessionId, runId);
    const recordAndPublish = this.options.runs.createEventRecorder(runId);

    yield recordAndPublish({
      runId,
      type: "session",
      session: this.options.sessions.summarizeSession(session),
      run,
    });

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
    const unsubscribeApprovalEvents = subscribeApprovalEvents(this.options.eventBus, runId, (event) => {
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
        this.options.runs.saveRun(run);
        yield recordAndPublish({ runId, type: "error", message, run });
        return;
      }

      this.options.sessions.touchSession(session.sessionId);
      run.status = run.status === "aborted" ? "aborted" : sawError ? "error" : "done";
      run.endedAt = new Date().toISOString();
      this.options.runs.saveRun(run);
      yield recordAndPublish({
        runId,
        type: "done",
        session: this.options.sessions.summarizeSession(session),
        run,
      });
    } finally {
      if (this.options.activeRunBySessionId.get(session.sessionId) === runId) {
        this.options.activeRunBySessionId.delete(session.sessionId);
      }
      unsubscribeApprovalEvents();
      unsubscribe();
    }
  }
}
