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
import type { ApprovalRegistry } from "./approval-service";
import type { RunEventDraft } from "./run-events";

const APPROVAL_EVENT_CHANNEL = "zuu:approval";
const TOOL_INPUT_PREVIEW_LIMIT = 600;
const SENSITIVE_PATH_FRAGMENTS = [
  ".env",
  "/.ssh/",
  "/.ssh",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  "id_dsa",
  "auth.json",
  "auth-token.json",
  "/credential",
  "/credentials",
  "/secret",
  "/secrets",
  "/token",
  "/tokens",
  ".credential",
  ".secret",
  ".token",
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".npmrc",
  ".netrc",
  ".pypirc",
];

type ToolAction = "execute" | "modify" | "read" | "search" | "list";

interface ToolApprovalRule {
  risk: ApprovalRisk;
  scopeSuffix?: string;
}

interface ToolPolicy {
  action: ToolAction;
  kind: CreateApprovalRequest["kind"];
  defaultRule?: ToolApprovalRule;
  sensitivePathRule?: ToolApprovalRule;
}

const TOOL_POLICY = new Map<string, ToolPolicy>([
  ["bash", { action: "execute", kind: "command", defaultRule: { risk: "high" } }],
  ["edit", { action: "modify", kind: "filesystem", defaultRule: { risk: "high" } }],
  ["write", { action: "modify", kind: "filesystem", defaultRule: { risk: "high" } }],
  ["read", { action: "read", kind: "filesystem", sensitivePathRule: { risk: "high", scopeSuffix: "sensitive_path" } }],
  ["grep", { action: "search", kind: "filesystem", sensitivePathRule: { risk: "high", scopeSuffix: "sensitive_path" } }],
  ["find", { action: "search", kind: "filesystem", sensitivePathRule: { risk: "high", scopeSuffix: "sensitive_path" } }],
  ["ls", { action: "list", kind: "filesystem", sensitivePathRule: { risk: "high", scopeSuffix: "sensitive_path" } }],
]);

type ApprovalEvent =
  | { type: "approval_requested"; runId: string; approval: Approval }
  | { type: "approval_resolved"; runId: string; approval: Approval };

interface ApprovalExtensionOptions {
  approvals: ApprovalRegistry;
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
        const approvalDecision = approvalDecisionForToolCall(event);
        const requiresApproval = Boolean(approvalDecision);
        const request = createToolApprovalRequest(
          event,
          ctx.sessionManager.getSessionId(),
          options.getActiveRunId,
          approvalDecision,
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
  decision: ToolApprovalDecision | undefined,
): CreateApprovalRequest | undefined {
  if (!decision) return undefined;

  const runId = getActiveRunId(sessionId);
  if (!runId) return undefined;
  const scope = decision.scopeSuffix ? `tool:${event.toolName}:${decision.scopeSuffix}` : `tool:${event.toolName}`;

  return {
    sessionId,
    runId,
    kind: decision.policy.kind,
    scope,
    title: decision.scopeSuffix ? `Allow ${event.toolName} sensitive path access` : `Allow ${event.toolName}`,
    description: decision.scopeSuffix
      ? `The agent requested ${event.toolName} ${decision.policy.action} access to a sensitive path with input: ${previewInput(event.input)}`
      : `The agent requested the ${event.toolName} ${decision.policy.action} tool with input: ${previewInput(event.input)}`,
    risk: decision.risk,
  };
}

interface ToolApprovalDecision extends ToolApprovalRule {
  policy: ToolPolicy;
}

function approvalDecisionForToolCall(event: ToolCallEvent): ToolApprovalDecision | undefined {
  const policy = TOOL_POLICY.get(event.toolName);
  if (!policy) return undefined;
  if (policy.sensitivePathRule && inputReferencesSensitivePath(event.input)) {
    return { ...policy.sensitivePathRule, policy };
  }
  return policy.defaultRule ? { ...policy.defaultRule, policy } : undefined;
}

function inputReferencesSensitivePath(input: unknown) {
  const preview = previewInput(input).replace(/\\\\/g, "/").toLowerCase();
  return SENSITIVE_PATH_FRAGMENTS.some((fragment) => preview.includes(fragment));
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
