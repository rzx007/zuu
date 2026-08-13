import type { PromptStreamEvent } from "@zuu/client";
import { JsonFileStore } from "../storage/json-file-store";
import { isPromptStreamEvent } from "./run-event-query";

const RUN_EVENT_HISTORY_LIMIT = 200;

export interface RunEventRecord {
  runId: string;
  updatedAt: string;
  events: PromptStreamEvent[];
}

export function loadRunEventRecords(path: string): RunEventRecord[] {
  return createRunEventStore(path).load(Array.isArray).filter(isRunEventRecord);
}

export function saveRunEventRecords(path: string, records: RunEventRecord[]) {
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

function countRecordEvents(value: unknown) {
  if (!value || typeof value !== "object" || !("events" in value)) return 0;
  return Array.isArray(value.events) ? value.events.length : 0;
}
