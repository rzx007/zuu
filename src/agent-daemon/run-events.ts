import type { EventStreamQuery, PromptStreamEvent } from "@zuu/client";
import { JsonFileStore } from "./json-file-store";

const RUN_EVENT_HISTORY_LIMIT = 200;
const RUN_EVENT_LIMIT = 1_000;

interface RunEventRecord {
  runId: string;
  updatedAt: string;
  events: PromptStreamEvent[];
}

export type RunEventDraft = Omit<PromptStreamEvent, "id" | "createdAt">;

function isRunEventRecord(value: unknown): value is RunEventRecord {
  return Boolean(
    value &&
      typeof value === "object" &&
      "runId" in value &&
      "updatedAt" in value &&
      "events" in value &&
      Array.isArray((value as { events?: unknown }).events) &&
      (value as { events: unknown[] }).events.every(isPromptStreamEvent),
  );
}

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

function loadRunEventRecords(path: string): RunEventRecord[] {
  return createRunEventStore(path).load(Array.isArray).filter(isRunEventRecord);
}

function saveRunEventRecords(path: string, records: RunEventRecord[]) {
  createRunEventStore(path).save(records.slice(0, RUN_EVENT_HISTORY_LIMIT));
}

function createRunEventStore(path: string) {
  return new JsonFileStore<unknown[]>({
    name: "run-events",
    path,
    defaultValue: [],
    countRecords: (value) => value.reduce<number>((count, record) => count + countRecordEvents(record), 0),
  });
}

function countRecordEvents(value: unknown) {
  if (!value || typeof value !== "object" || !("events" in value)) return 0;
  return Array.isArray(value.events) ? value.events.length : 0;
}

function isPromptStreamEvent(value: unknown): value is PromptStreamEvent {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      typeof value.id === "string" &&
      "createdAt" in value &&
      typeof value.createdAt === "string" &&
      "runId" in value &&
      typeof value.runId === "string" &&
      "type" in value &&
      typeof value.type === "string",
  );
}

function inferNextSequence(events: PromptStreamEvent[]) {
  return events.reduce((max, event) => {
    const suffix = event.id.split(":").pop();
    const sequence = suffix ? Number(suffix) : Number.NaN;
    return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
  }, 0);
}

function snapshotEvent(event: PromptStreamEvent): PromptStreamEvent {
  return JSON.parse(JSON.stringify(event)) as PromptStreamEvent;
}

function eventsAfter(events: PromptStreamEvent[], afterEventId?: string) {
  if (!afterEventId) return events;
  const index = events.findIndex((event) => event.id === afterEventId);
  return index >= 0 ? events.slice(index + 1) : events;
}

export function matchesEventQuery(event: PromptStreamEvent, query: EventStreamQuery = {}) {
  const matchesRun = !query.runId || event.runId === query.runId;
  const matchesSession =
    !query.sessionId || event.session?.id === query.sessionId || event.run?.sessionId === query.sessionId;
  return matchesRun && matchesSession;
}

function compareEvents(a: PromptStreamEvent, b: PromptStreamEvent) {
  const byTime = a.createdAt.localeCompare(b.createdAt);
  return byTime || a.id.localeCompare(b.id);
}
