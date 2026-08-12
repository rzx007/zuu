import type { EventStreamQuery, PromptRequest, PromptStreamEvent, RunSummary } from "@zuu/client";
import { loadRunHistory, saveRunHistory } from "./run-history";
import { matchesEventQuery, RunEventStore, type RunEventDraft } from "./run-events";

type EventListener = (event: PromptStreamEvent) => void;

export class RunService {
  private readonly runEventStore: RunEventStore;
  private readonly eventListeners = new Set<EventListener>();
  private readonly runs: Map<string, RunSummary>;

  constructor(
    private readonly runStorePath: string,
    runEventStorePath: string,
  ) {
    this.runEventStore = new RunEventStore(runEventStorePath);
    this.runs = new Map(loadRunHistory(runStorePath).map((run) => [run.id, run]));
  }

  listRuns(sessionId?: string, projectId?: string) {
    return [...this.runs.values()]
      .filter((run) => !sessionId || run.sessionId === sessionId)
      .filter((run) => !projectId || run.projectId === projectId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  startRun(input: { sessionId: string; projectId: string; request: PromptRequest }) {
    const run: RunSummary = {
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      projectId: input.projectId,
      status: "running",
      prompt: input.request.prompt,
      startedAt: new Date().toISOString(),
    };
    this.saveRun(run);
    return run;
  }

  saveRun(run: RunSummary) {
    this.runs.set(run.id, run);
    this.persistRuns();
  }

  getRun(runId: string, projectId?: string) {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    if (projectId && run.projectId !== projectId) throw new Error(`Unknown run: ${runId}`);
    return run;
  }

  listRunEvents(runId: string, afterEventId?: string, projectId?: string) {
    this.getRun(runId, projectId);
    return this.runEventStore.list(runId, afterEventId);
  }

  listEvents(query: EventStreamQuery = {}) {
    if (query.runId) this.getRun(query.runId);
    return this.runEventStore.listAll(query);
  }

  subscribeEvents(query: EventStreamQuery, listener: EventListener) {
    const filteredListener = (event: PromptStreamEvent) => {
      if (matchesEventQuery(event, query)) listener(event);
    };
    this.eventListeners.add(filteredListener);
    return () => this.eventListeners.delete(filteredListener);
  }

  createEventRecorder(runId: string) {
    const recordEvent = this.runEventStore.createRecorder(runId);
    return (event: RunEventDraft) => {
      const recorded = recordEvent(event);
      this.publishEvent(recorded);
      return recorded;
    };
  }

  abortSessionRuns(sessionId: string, endedAt = new Date().toISOString()) {
    let changed = false;
    for (const run of this.runs.values()) {
      if (run.sessionId === sessionId && run.status === "running") {
        run.status = "aborted";
        run.endedAt = endedAt;
        changed = true;
      }
    }
    if (changed) this.persistRuns();
  }

  clear() {
    this.runs.clear();
    this.eventListeners.clear();
  }

  private persistRuns() {
    saveRunHistory(this.runStorePath, this.listRuns());
  }

  private publishEvent(event: PromptStreamEvent) {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }
}
