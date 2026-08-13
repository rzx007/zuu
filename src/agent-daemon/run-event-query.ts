import type { EventStreamQuery, PromptStreamEvent } from "@zuu/client";

export function isPromptStreamEvent(value: unknown): value is PromptStreamEvent {
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

export function snapshotEvent(event: PromptStreamEvent): PromptStreamEvent {
  return JSON.parse(JSON.stringify(event)) as PromptStreamEvent;
}

export function eventsAfter(events: PromptStreamEvent[], afterEventId?: string) {
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

export function compareEvents(a: PromptStreamEvent, b: PromptStreamEvent) {
  const byTime = a.createdAt.localeCompare(b.createdAt);
  return byTime || a.id.localeCompare(b.id);
}
