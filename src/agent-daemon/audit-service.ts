import type { AuditEvent, AuditEventAction, AuditEventOutcome } from "@zuu/client";
import { JsonFileStore } from "./json-file-store";

const AUDIT_EVENT_LIMIT = 1_000;

export interface RecordAuditEventRequest {
  action: AuditEventAction;
  target?: string;
  outcome?: AuditEventOutcome;
  details?: Record<string, unknown>;
}

export class AuditService {
  private readonly store: JsonFileStore<AuditEvent[]>;
  private events: AuditEvent[];

  constructor(path: string) {
    this.store = new JsonFileStore<AuditEvent[]>({
      name: "audit-events",
      path,
      defaultValue: [],
      countRecords: (value) => value.length,
    });
    this.events = this.store.load(isAuditEventArray);
  }

  list(limit = 100) {
    const normalizedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    return this.events.slice(0, normalizedLimit);
  }

  record(request: RecordAuditEventRequest) {
    const event: AuditEvent = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      actor: "api",
      action: request.action,
      outcome: request.outcome ?? "success",
      target: request.target,
      details: request.details,
    };
    this.events = [event, ...this.events].slice(0, AUDIT_EVENT_LIMIT);
    this.store.save(this.events);
    return event;
  }
}

function isAuditEventArray(value: unknown): value is AuditEvent[] {
  return Array.isArray(value) && value.every(isAuditEvent);
}

function isAuditEvent(value: unknown): value is AuditEvent {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      typeof value.id === "string" &&
      "createdAt" in value &&
      typeof value.createdAt === "string" &&
      "actor" in value &&
      value.actor === "api" &&
      "action" in value &&
      typeof value.action === "string" &&
      "outcome" in value &&
      (value.outcome === "success" || value.outcome === "failure"),
  );
}
