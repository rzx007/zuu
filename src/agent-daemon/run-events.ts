import type { EventStreamQuery, PromptStreamEvent } from "@zuu/client";
import { loadRunEventRecords, saveRunEventRecords, type RunEventRecord } from "./run-event-records";
import { compareEvents, eventsAfter, matchesEventQuery, snapshotEvent } from "./run-event-query";

const RUN_EVENT_LIMIT = 1_000;

export type RunEventDraft = Omit<PromptStreamEvent, "id" | "createdAt">;

export class RunEventStore {
  private readonly records: Map<string, RunEventRecord>;
  private readonly sequences = new Map<string, number>();

  constructor(private readonly path: string) {
    this.records = new Map(loadRunEventRecords(path).map((record) => [record.runId, record]));
    for (const record of this.records.values()) {
      this.sequences.set(record.runId, inferNextSequence(record.events));
    }
  }

  createRecorder(runId: string) {
    return (event: RunEventDraft): PromptStreamEvent => {
      const sequence = (this.sequences.get(runId) ?? 0) + 1;
      this.sequences.set(runId, sequence);
      const recorded = {
        ...event,
        runId,
        id: `${runId}:${sequence}`,
        createdAt: new Date().toISOString(),
      };
      const snapshot = snapshotEvent(recorded);
      this.append(snapshot);
      return snapshot;
    };
  }

  list(runId: string, afterEventId?: string) {
    const events = this.records.get(runId)?.events ?? [];
    return eventsAfter(events, afterEventId);
  }

  listAll(query: EventStreamQuery = {}) {
    const events = [...this.records.values()]
      .flatMap((record) => record.events)
      .filter((event) => matchesEventQuery(event, query))
      .sort(compareEvents);
    return eventsAfter(events, query.afterEventId);
  }

  private append(event: PromptStreamEvent) {
    const existing = this.records.get(event.runId);
    const record: RunEventRecord = {
      runId: event.runId,
      updatedAt: new Date().toISOString(),
      events: [...(existing?.events ?? []), event].slice(-RUN_EVENT_LIMIT),
    };
    this.records.set(event.runId, record);
    this.persist();
  }

  private persist() {
    saveRunEventRecords(this.path, [...this.records.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }
}

function inferNextSequence(events: PromptStreamEvent[]) {
  return events.reduce((max, event) => {
    const suffix = event.id.split(":").pop();
    const sequence = suffix ? Number(suffix) : Number.NaN;
    return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
  }, 0);
}
