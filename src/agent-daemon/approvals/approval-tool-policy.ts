import type { ApprovalRisk, CreateApprovalRequest } from "@zuu/client";
import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { inputReferencesSensitivePath } from "./approval-sensitive-paths";

const TOOL_INPUT_PREVIEW_LIMIT = 600;
const TOOL_APPROVAL_TIMEOUT_MS = 10 * 60_000;

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

interface ToolApprovalDecision extends ToolApprovalRule {
  policy: ToolPolicy;
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

export function createToolApprovalRequest(
  event: ToolCallEvent,
  sessionId: string,
  getActiveRunId: (sessionId: string) => string | undefined,
  decision: ToolApprovalDecision | undefined,
  canWaitForApproval: boolean,
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
    expiresAt: new Date(Date.now() + (canWaitForApproval ? TOOL_APPROVAL_TIMEOUT_MS : 0)).toISOString(),
  };
}

export function approvalDecisionForToolCall(event: ToolCallEvent): ToolApprovalDecision | undefined {
  const policy = TOOL_POLICY.get(event.toolName);
  if (!policy) return undefined;
  if (policy.sensitivePathRule && inputReferencesSensitivePath(event.input)) {
    return { ...policy.sensitivePathRule, policy };
  }
  return policy.defaultRule ? { ...policy.defaultRule, policy } : undefined;
}

function previewInput(input: unknown) {
  const preview = JSON.stringify(input);
  if (!preview) return "";
  return preview.length > TOOL_INPUT_PREVIEW_LIMIT
    ? `${preview.slice(0, TOOL_INPUT_PREVIEW_LIMIT)}...`
    : preview;
}
