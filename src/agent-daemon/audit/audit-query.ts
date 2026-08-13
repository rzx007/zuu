import type { AuditEvent, AuditEventAction, AuditEventOutcome, AuthScope } from "@zuu/client";

export interface AuditEventFilter {
  limit?: number;
  action?: AuditEventAction;
  outcome?: AuditEventOutcome;
  target?: string;
  authScope?: AuthScope;
  authActor?: string;
  authTokenId?: string;
  since?: string;
  until?: string;
}

export function filterAuditEvents(events: AuditEvent[], input: number | AuditEventFilter = {}) {
  const filter = typeof input === "number" ? { limit: input } : input;
  const normalizedLimit = Math.max(1, Math.min(500, Math.floor(filter.limit ?? 100)));
  return events
    .filter((event) => !filter.action || event.action === filter.action)
    .filter((event) => !filter.outcome || event.outcome === filter.outcome)
    .filter((event) => !filter.target || event.target?.includes(filter.target))
    .filter((event) => !filter.authScope || event.details?.authScope === filter.authScope)
    .filter((event) => !filter.authActor || event.details?.authActor === filter.authActor)
    .filter((event) => !filter.authTokenId || event.details?.authTokenId === filter.authTokenId)
    .filter((event) => !filter.since || event.createdAt >= filter.since)
    .filter((event) => !filter.until || event.createdAt <= filter.until)
    .slice(0, normalizedLimit);
}
