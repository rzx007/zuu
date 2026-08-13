import type { Approval } from "@zuu/client";
import type { EventBus } from "@earendil-works/pi-coding-agent";
import type { RunEventDraft } from "./run-events";

const APPROVAL_EVENT_CHANNEL = "zuu:approval";

type ApprovalEvent =
  | { type: "approval_requested"; runId: string; approval: Approval }
  | { type: "approval_resolved"; runId: string; approval: Approval };

export function emitApprovalEvent(eventBus: EventBus, event: ApprovalEvent) {
  eventBus.emit(APPROVAL_EVENT_CHANNEL, event);
}

export function subscribeApprovalEvents(
  eventBus: EventBus,
  runId: string,
  listener: (event: RunEventDraft) => void,
) {
  return eventBus.on(APPROVAL_EVENT_CHANNEL, (event) => {
    if (isApprovalEvent(event) && event.runId === runId) {
      listener({
        runId: event.runId,
        type: event.type,
        approval: event.approval,
      });
    }
  });
}

function isApprovalEvent(value: unknown): value is ApprovalEvent {
  return Boolean(
    value &&
      typeof value === "object" &&
      "type" in value &&
      (value.type === "approval_requested" || value.type === "approval_resolved") &&
      "runId" in value &&
      typeof value.runId === "string" &&
      "approval" in value,
  );
}
