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

export type WorkflowRunStatus = "queued" | "running" | "done" | "error" | "aborted";
export type WorkflowArtifactKind = "text" | "json" | "file";

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  tags: string[];
}

export type WorkflowBackendKind = "fake" | "pi-package";
export type WorkflowBackendStatus = "ready" | "unavailable";

export interface WorkflowBackendInfo {
  kind: WorkflowBackendKind;
  status: WorkflowBackendStatus;
  label: string;
  packageInstalled: boolean;
  packageSource?: string;
  message?: string;
}

export interface WorkflowStage {
  id: string;
  runId: string;
  name: string;
  status: WorkflowRunStatus;
  startedAt?: string;
  endedAt?: string;
  summary?: string;
}

export interface WorkflowTask {
  id: string;
  runId: string;
  stageId: string;
  name: string;
  status: WorkflowRunStatus;
  startedAt?: string;
  endedAt?: string;
  input?: unknown;
  output?: unknown;
  artifactIds: string[];
}

export interface WorkflowArtifact {
  id: string;
  runId: string;
  taskId?: string;
  name: string;
  kind: WorkflowArtifactKind;
  mimeType?: string;
  content?: unknown;
  createdAt: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  status: WorkflowRunStatus;
  source: "user" | "schedule" | "api";
  sessionId?: string;
  prompt?: string;
  startedAt: string;
  endedAt?: string;
  stages: WorkflowStage[];
  tasks: WorkflowTask[];
  artifacts: WorkflowArtifact[];
  error?: string;
}

export interface StartWorkflowRequest {
  sessionId?: string;
  prompt?: string;
  inputs?: Record<string, unknown>;
  source?: WorkflowRun["source"];
}

export interface WorkflowsResponse {
  workflows: WorkflowDefinition[];
  backend: WorkflowBackendInfo;
}

export interface WorkflowRunsResponse {
  runs: WorkflowRun[];
}

export interface WorkflowRunResponse {
  run: WorkflowRun;
}

export type ScheduleStatus = "active" | "paused";
export type ScheduleTriggerKind = "once" | "interval" | "cron";
export type ScheduleRunStatus = "running" | "done" | "error";

export interface ScheduleTrigger {
  kind: ScheduleTriggerKind;
  runAt?: string;
  everyMs?: number;
  cron?: string;
  timezone?: string;
}

export type ScheduleAction =
  | {
      type: "prompt";
      prompt: string;
      sessionId?: string;
      name?: string;
      model?: PromptRequest["model"];
      thinkingLevel?: ThinkingLevel;
      tools?: string[];
      persist?: boolean;
    }
  | {
      type: "workflow";
      workflowId: string;
      prompt?: string;
      sessionId?: string;
      inputs?: Record<string, unknown>;
    };

export interface ScheduleRun {
  id: string;
  scheduleId: string;
  status: ScheduleRunStatus;
  startedAt: string;
  endedAt?: string;
  agentRunId?: string;
  workflowRunId?: string;
  error?: string;
}

export interface Schedule {
  id: string;
  name: string;
  status: ScheduleStatus;
  trigger: ScheduleTrigger;
  action: ScheduleAction;
  createdAt: string;
  updatedAt: string;
  nextRunAt?: string;
  lastRunAt?: string;
  runs: ScheduleRun[];
}

export interface CreateScheduleRequest {
  name?: string;
  trigger: ScheduleTrigger;
  action: ScheduleAction;
}

export interface SchedulesResponse {
  schedules: Schedule[];
}

export interface ScheduleResponse {
  schedule: Schedule;
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
    workflowBackend: WorkflowBackendInfo;
  };
  gaps: string[];
}

export interface PackagesResponse {
  packages: PackageSummary[];
}

export interface PackageInstallResponse extends PackagesResponse {
  operation: PackageOperation;
}

export interface PackageOperationsResponse {
  operations: PackageOperation[];
}

export interface PackageOperationResponse {
  operation: PackageOperation;
}

export interface PackageMutationRequest {
  source: string;
}

export type PackageStatus = "configured" | "installed" | "filtered";
export type PackageScope = "user" | "project";
export type PackageOperationAction = "install";
export type PackageOperationStatus = "running" | "done" | "error";
export type PackageProgressAction = "install" | "remove" | "update" | "clone" | "pull";
export type PackageProgressEventType = "start" | "progress" | "complete" | "error";

export interface PackageSummary {
  source: string;
  scope: PackageScope;
  filtered: boolean;
  installedPath?: string;
  status: PackageStatus;
}

export interface PackageOperationEvent {
  id: string;
  operationId: string;
  type: PackageProgressEventType;
  action: PackageProgressAction;
  source: string;
  message?: string;
  createdAt: string;
}

export interface PackageOperation {
  id: string;
  source: string;
  action: PackageOperationAction;
  status: PackageOperationStatus;
  startedAt: string;
  endedAt?: string;
  error?: string;
  events: PackageOperationEvent[];
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
