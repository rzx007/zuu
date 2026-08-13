import type {
  InlineExtension,
} from "@earendil-works/pi-coding-agent";
import { emitApprovalEvent } from "./approval-events";
import { approvalDecisionForToolCall, createToolApprovalRequest } from "./approval-tool-policy";
import type { ApprovalRegistry } from "./approval-service";

interface ApprovalExtensionOptions {
  approvals: ApprovalRegistry;
  getActiveRunId(sessionId: string): string | undefined;
  canWaitForApproval?(sessionId: string): boolean;
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
          emitApprovalEvent(pi.events, {
            type: "approval_resolved",
            runId: request.runId,
            approval: grant,
          });
          return undefined;
        }

        const approval = options.approvals.create(request);
        emitApprovalEvent(pi.events, {
          type: "approval_requested",
          runId: request.runId,
          approval,
        });

        const resolved = await options.approvals.waitForResolution(approval.id);
        emitApprovalEvent(pi.events, {
          type: "approval_resolved",
          runId: request.runId,
          approval: resolved,
        });

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
