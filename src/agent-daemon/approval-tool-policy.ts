import type { ApprovalRisk, CreateApprovalRequest } from "@zuu/client";
import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";

const TOOL_INPUT_PREVIEW_LIMIT = 600;
const TOOL_APPROVAL_TIMEOUT_MS = 10 * 60_000;
const PATH_INPUT_KEYS = new Set([
  "cwd",
  "dir",
  "directory",
  "exclude",
  "file",
  "files",
  "glob",
  "include",
  "path",
  "paths",
  "root",
  "target",
]);
const SENSITIVE_PATH_BASENAMES = new Set([
  ".env",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  "id_dsa",
  "auth.json",
  "auth-token.json",
  ".npmrc",
  ".netrc",
  ".pypirc",
]);
const SENSITIVE_PATH_SEGMENTS = new Set([".ssh", "credential", "credentials", "secret", "secrets", "token", "tokens"]);
const SENSITIVE_PATH_EXTENSIONS = [".credential", ".secret", ".token", ".pem", ".key", ".p12", ".pfx"];

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

function inputReferencesSensitivePath(input: unknown) {
  return collectPathCandidates(input).some(isSensitivePathCandidate);
}

function collectPathCandidates(value: unknown, key?: string): string[] {
  if (typeof value === "string") {
    return isPathInputKey(key) || looksLikePath(value) ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectPathCandidates(item, key));
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).flatMap(([childKey, childValue]) => collectPathCandidates(childValue, childKey));
}

function isPathInputKey(key: string | undefined) {
  return Boolean(key && PATH_INPUT_KEYS.has(key.toLowerCase()));
}

function looksLikePath(value: string) {
  return value.startsWith(".") || value.includes("/") || value.includes("\\") || /^[a-z]:/i.test(value);
}

function isSensitivePathCandidate(value: string) {
  const normalized = value.replace(/\\/g, "/").toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  const basename = segments[segments.length - 1] || normalized;
  return (
    SENSITIVE_PATH_BASENAMES.has(basename) ||
    segments.some((segment) => SENSITIVE_PATH_SEGMENTS.has(segment)) ||
    SENSITIVE_PATH_EXTENSIONS.some((extension) => basename.endsWith(extension))
  );
}

function previewInput(input: unknown) {
  const preview = JSON.stringify(input);
  if (!preview) return "";
  return preview.length > TOOL_INPUT_PREVIEW_LIMIT
    ? `${preview.slice(0, TOOL_INPUT_PREVIEW_LIMIT)}...`
    : preview;
}
