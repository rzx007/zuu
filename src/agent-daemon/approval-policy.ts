import type {
  Approval,
  ApprovalRisk,
  CreateApprovalRequest,
} from "@zuu/client";
import type {
  EventBus,
  InlineExtension,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import type { ApprovalStore } from "./approval-store";
import type { RunEventDraft } from "./run-events";

const APPROVAL_EVENT_CHANNEL = "zuu:approval";
const TOOL_INPUT_PREVIEW_LIMIT = 600;
const APPROVAL_REQUIRED_TOOLS = new Map<string, ApprovalRisk>([
  ["bash", "high"],
  ["edit", "high"],
  ["write", "high"],
]);

type ApprovalEvent =
  | { type: "approval_requested"; runId: string; approval: Approval }
  | { type: "approval_resolved"; runId: string; approval: Approval };

interface ApprovalExtensionOptions {
  approvalStore: ApprovalStore;
  getActiveRunId(sessionId: string): string | undefined;
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
      pi.on("tool_call", (event, ctx) => {
        const requiresApproval = APPROVAL_REQUIRED_TOOLS.has(event.toolName);
        const request = createToolApprovalRequest(
          event,
          ctx.sessionManager.getSessionId(),
          options.getActiveRunId,
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

        const grant = options.approvalStore.consumeGrant(request);
        if (grant) {
          pi.events.emit(APPROVAL_EVENT_CHANNEL, {
            type: "approval_resolved",
            runId: request.runId,
            approval: grant,
          } satisfies ApprovalEvent);
          return undefined;
        }

        const approval = options.approvalStore.create(request);
        pi.events.emit(APPROVAL_EVENT_CHANNEL, {
          type: "approval_requested",
          runId: request.runId,
          approval,
        } satisfies ApprovalEvent);

        return {
          block: true,
          terminate: true,
          reason: `Approval required for ${event.toolName}. Resolve approval ${approval.id} with allow_session and retry.`,
        };
      });
    },
  };
}

function createToolApprovalRequest(
  event: ToolCallEvent,
  sessionId: string,
  getActiveRunId: (sessionId: string) => string | undefined,
): CreateApprovalRequest | undefined {
  const risk = APPROVAL_REQUIRED_TOOLS.get(event.toolName);
  if (!risk) return undefined;

  const runId = getActiveRunId(sessionId);
  if (!runId) return undefined;

  return {
    sessionId,
    runId,
    kind: event.toolName === "bash" ? "command" : "filesystem",
    scope: `tool:${event.toolName}`,
    title: `Allow ${event.toolName}`,
    description: `The agent requested the ${event.toolName} tool with input: ${previewInput(event.input)}`,
    risk,
  };
}

function previewInput(input: unknown) {
  const preview = JSON.stringify(input);
  if (!preview) return "";
  return preview.length > TOOL_INPUT_PREVIEW_LIMIT
    ? `${preview.slice(0, TOOL_INPUT_PREVIEW_LIMIT)}...`
    : preview;
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
