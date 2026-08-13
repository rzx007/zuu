import type {
  Approval,
} from "@zuu/client";
import type {
  EventBus,
  InlineExtension,
} from "@earendil-works/pi-coding-agent";
import { approvalDecisionForToolCall, createToolApprovalRequest } from "./approval-tool-policy";
import type { ApprovalRegistry } from "./approval-service";
import type { RunEventDraft } from "./run-events";

const APPROVAL_EVENT_CHANNEL = "zuu:approval";

type ApprovalEvent =
  | { type: "approval_requested"; runId: string; approval: Approval }
  | { type: "approval_resolved"; runId: string; approval: Approval };

interface ApprovalExtensionOptions {
  approvals: ApprovalRegistry;
  getActiveRunId(sessionId: string): string | undefined;
  canWaitForApproval?(sessionId: string): boolean;
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

export function createApprovalExtension(options: ApprovalExtensionOptions): InlineExtension {
  return {
    name: "zuu-approval-policy",
    hidden: true,
    factory: (pi) => {
      pi.on("tool_call", async (event, ctx) => {
        const approvalDecision = approvalDecisionForToolCall(event);
        const requiresApproval = Boolean(approvalDecision);
        const sessionId = ctx.sessionManager.getSessionId();
        const request = createToolApprovalRequest(
          event,
          sessionId,
          options.getActiveRunId,
          approvalDecision,
          options.canWaitForApproval?.(sessionId) ?? true,
        );
        if (!request) {
          return requiresApproval
            ? {
                block: true,
                terminate: true,
                reason: `Approval required for ${event.toolName}, but no active Zuu run is registered.`,
              }
            : undefined;
        }

        const grant = options.approvals.consumeGrant(request);
        if (grant) {
          pi.events.emit(APPROVAL_EVENT_CHANNEL, {
            type: "approval_resolved",
            runId: request.runId,
            approval: grant,
          } satisfies ApprovalEvent);
          return undefined;
        }

        const approval = options.approvals.create(request);
        pi.events.emit(APPROVAL_EVENT_CHANNEL, {
          type: "approval_requested",
          runId: request.runId,
          approval,
        } satisfies ApprovalEvent);

        const resolved = await options.approvals.waitForResolution(approval.id);
        pi.events.emit(APPROVAL_EVENT_CHANNEL, {
          type: "approval_resolved",
          runId: request.runId,
          approval: resolved,
        } satisfies ApprovalEvent);

        if (resolved.status === "allowed") {
          options.approvals.consumeGrant(request);
          return undefined;
        }

        return {
          block: true,
          terminate: true,
          reason:
            resolved.status === "expired"
              ? `Approval expired for ${event.toolName}.`
              : `Approval denied for ${event.toolName}.`,
        };
      });
    },
  };
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
