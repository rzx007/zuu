export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface SessionSummary {
  id: string;
  name?: string;
  cwd: string;
  model?: string;
  thinkingLevel: ThinkingLevel;
  activeTools: string[];
  messageCount: number;
  isStreaming: boolean;
  sessionFile?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunSummary {
  id: string;
  sessionId: string;
  status: "running" | "done" | "error" | "aborted";
  prompt: string;
  startedAt: string;
  endedAt?: string;
}

export type ApprovalKind = "tool" | "command" | "filesystem" | "network" | "package";
export type ApprovalRisk = "low" | "medium" | "high" | "critical";
export type ApprovalStatus = "pending" | "allowed" | "denied" | "expired";
export type ApprovalDecision = "allow_once" | "allow_session" | "deny";

export interface Approval {
  id: string;
  sessionId: string;
  runId: string;
  kind: ApprovalKind;
  scope?: string;
  title: string;
  description: string;
  risk: ApprovalRisk;
  status: ApprovalStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  resolvedAt?: string;
  usedAt?: string;
  decision?: ApprovalDecision;
}

export interface CreateApprovalRequest {
  sessionId: string;
  runId: string;
  kind: ApprovalKind;
  scope?: string;
  title: string;
  description: string;
  risk: ApprovalRisk;
  expiresAt?: string;
}

export interface ResolveApprovalRequest {
  decision: ApprovalDecision;
}

export interface PromptRequest {
  prompt: string;
  sessionId?: string;
  name?: string;
  cwd?: string;
  sessionFile?: string;
  continueRecent?: boolean;
  model?: {
    provider: string;
    id: string;
  };
  thinkingLevel?: ThinkingLevel;
  tools?: string[];
  persist?: boolean;
}

export interface PromptStreamEvent {
  runId: string;
  type:
    | "session"
    | "text_delta"
    | "tool_start"
    | "tool_update"
    | "tool_end"
    | "agent_event"
    | "approval_requested"
    | "approval_resolved"
    | "done"
    | "error";
  session?: SessionSummary;
  delta?: string;
  message?: string;
  tool?: {
    id: string;
    name: string;
    args?: unknown;
    result?: unknown;
    isError?: boolean;
  };
  eventType?: string;
  approval?: Approval;
  run?: RunSummary;
}

export interface HealthResponse {
  ok: boolean;
}

export interface SessionsResponse {
  sessions: SessionSummary[];
}

export interface SessionResponse {
  session: SessionSummary;
}

export interface SessionTreeEntry {
  id: string;
  parentId: string | null;
  type: string;
  timestamp: string;
  label?: string;
  role?: string;
  text?: string;
  children: SessionTreeEntry[];
}

export interface SessionTreeResponse {
  tree: SessionTreeEntry[];
}

export interface StoredSessionSummary {
  id: string;
  path: string;
  cwd: string;
  name?: string;
  parentSessionPath?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  firstMessage: string;
  isActive: boolean;
}

export interface StoredSessionsResponse {
  sessions: StoredSessionSummary[];
}

export interface OpenSessionRequest {
  sessionFile: string;
  cwdOverride?: string;
  name?: string;
  model?: PromptRequest["model"];
  thinkingLevel?: ThinkingLevel;
  tools?: string[];
}

export interface SessionActionResponse {
  session: SessionSummary;
  cancelled: boolean;
  selectedText?: string;
}

export interface NewSessionRequest {
  name?: string;
  parentSession?: string;
}

export interface SwitchSessionRequest {
  sessionFile: string;
  cwdOverride?: string;
}

export interface ForkSessionRequest {
  entryId: string;
  position?: "before" | "at";
}

export interface ImportSessionRequest {
  path: string;
  cwdOverride?: string;
}

export interface RunsResponse {
  runs: RunSummary[];
}

export interface RunResponse {
  run: RunSummary;
}

export interface ApprovalsResponse {
  approvals: Approval[];
}

export interface ApprovalResponse {
  approval: Approval;
}

export interface Diagnostics {
  ok: boolean;
  cwd: string;
  runtime: {
    node: string;
    platform: string;
    nodeVersionRequired: string;
  };
  sdk: {
    package: string;
    version: string;
  };
  models: {
    configuredProviders: string[];
    availableCount: number;
    active?: string;
    error?: string;
  };
  resources: {
    skills: number;
    prompts: number;
    extensions: number;
    extensionErrors: Array<{ path: string; error: string }>;
    packages: string[];
  };
  gaps: string[];
}

export interface PackagesResponse {
  packages: string[];
}

export interface PackageMutationRequest {
  source: string;
}

export interface ModelSummary {
  provider: string;
  id: string;
  label?: string;
}

export interface ModelsResponse {
  models: ModelSummary[];
  configuredProviders: string[];
}

export interface ApiErrorResponse {
  error: {
    message: string;
    status: number;
  };
}
