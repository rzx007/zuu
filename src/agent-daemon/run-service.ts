import type { EventStreamQuery, PromptRequest, PromptStreamEvent, RunSummary } from "@zuu/client";
import { notFound } from "../http";
import { matchesEventQuery } from "./run-event-query";
import { loadRunHistory, saveRunHistory } from "./run-history";
import { abortActiveSessionRuns, createRunSummary } from "./run-mutations";
import { RunEventStore, type RunEventDraft } from "./run-events";

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
    const run = createRunSummary(input);
    this.saveRun(run);
    return run;
  }

  saveRun(run: RunSummary) {
    this.runs.set(run.id, run);
    this.persistRuns();
  }

  getRun(runId: string, projectId?: string) {
    const run = this.runs.get(runId);
    if (!run) notFound(`Unknown run: ${runId}`, { runId });
    if (projectId && run.projectId !== projectId) notFound(`Unknown run: ${runId}`, { runId, projectId });
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

  abortSessionRuns(sessionId: string, finishedAt = new Date().toISOString()) {
    const changed = abortActiveSessionRuns(this.runs.values(), sessionId, finishedAt);
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
