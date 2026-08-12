export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type ProjectStatus = "ready" | "unavailable";

export interface ProjectSummary {
  id: string;
  name: string;
  cwd: string;
  agentDir: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectRequest {
  name?: string;
  cwd: string;
}

export interface UpdateProjectRequest {
  name?: string;
  cwd?: string;
}

export interface ProjectsResponse {
  projects: ProjectSummary[];
}

export interface ProjectResponse {
  project: ProjectSummary;
}

export interface SessionSummary {
  id: string;
  projectId: string;
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

export interface UpdateSessionRequest {
  name?: string;
  tools?: string[];
}

export interface RunSummary {
  id: string;
  sessionId: string;
  projectId: string;
  source: "user" | "schedule" | "workflow" | "api";
  status: "queued" | "running" | "waiting_approval" | "completed" | "failed" | "aborted";
  prompt: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
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
  projectId?: string;
  source?: RunSummary["source"];
  streamingBehavior?: "steer" | "followUp";
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

export interface ModelSmokeRequest {
  model?: PromptRequest["model"];
  projectId?: string;
  prompt?: string;
  thinkingLevel?: ThinkingLevel;
  timeoutMs?: number;
}

export interface ModelSmokeResponse {
  ok: boolean;
  status: RunSummary["status"] | "failed";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  eventCount: number;
  model?: PromptRequest["model"];
  run?: RunSummary;
  runId?: string;
  sessionId?: string;
  textPreview?: string;
  error?: string;
}

export interface PromptStreamEvent {
  id: string;
  createdAt: string;
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
  status: "ready" | "degraded";
  protocolVersion: "v1";
  version: string;
  startedAt: string;
  uptimeMs: number;
  node: string;
  platform: string;
}

export type AuthScope = "admin" | "read";

export interface AuthTokenStatus {
  id: string;
  actor: string;
  scope: AuthScope;
  tokenPreview: string;
  createdAt: string;
  rotatedAt?: string;
}

export interface AuthStatus {
  enabled: boolean;
  source: "env" | "local";
  canRotate: boolean;
  tokenPreview: string;
  tokenFile?: string;
  createdAt?: string;
  rotatedAt?: string;
  tokens: AuthTokenStatus[];
}

export interface AuthStatusResponse {
  auth: AuthStatus;
}

export interface AuthRotateResponse extends AuthStatusResponse {
  apiToken: string;
  readApiToken?: string;
}

export interface AuthCreateTokenRequest {
  scope: AuthScope;
  actor?: string;
}

export interface AuthCreateTokenResponse extends AuthStatusResponse {
  token: AuthTokenStatus;
  apiToken: string;
}

export interface AuthRevokeTokenResponse extends AuthStatusResponse {
  revoked: AuthTokenStatus;
}

export type AuditEventAction =
  | "api.read"
  | "api.mutate"
  | "auth.rotate"
  | "auth.token_create"
  | "auth.token_revoke"
  | "approval.resolve"
  | "package.add"
  | "package.install"
  | "package.update"
  | "package.remove"
  | "package.trust"
  | "package.revoke_trust";

export type AuditEventOutcome = "success" | "failure";

export interface AuditEvent {
  id: string;
  createdAt: string;
  actor: "api";
  action: AuditEventAction;
  outcome: AuditEventOutcome;
  target?: string;
  details?: Record<string, unknown>;
}

export interface AuditEventsResponse {
  events: AuditEvent[];
}

export interface AuditEventsQuery {
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
  projectId?: string;
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
  projectId?: string;
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

export interface RunEventsResponse {
  events: PromptStreamEvent[];
}

export interface EventStreamQuery {
  runId?: string;
  sessionId?: string;
  afterEventId?: string;
}

export type WorkflowRunStatus = "queued" | "running" | "completed" | "failed" | "aborted";
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
  finishedAt?: string;
  summary?: string;
}

export interface WorkflowTask {
  id: string;
  runId: string;
  stageId: string;
  name: string;
  status: WorkflowRunStatus;
  startedAt?: string;
  finishedAt?: string;
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
  projectId?: string;
  sessionId?: string;
  prompt?: string;
  startedAt: string;
  finishedAt?: string;
  stages: WorkflowStage[];
  tasks: WorkflowTask[];
  artifacts: WorkflowArtifact[];
  error?: string;
}

export interface StartWorkflowRequest {
  projectId?: string;
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

export interface WorkflowStagesResponse {
  stages: WorkflowStage[];
}

export interface WorkflowTasksResponse {
  tasks: WorkflowTask[];
}

export interface WorkflowArtifactResponse {
  artifact: WorkflowArtifact;
}

export type ScheduleStatus = "active" | "paused";
export type ScheduleTriggerKind = "once" | "interval" | "cron";
export type ScheduleRunStatus = "queued" | "running" | "completed" | "failed" | "skipped" | "aborted";
export type ScheduleOverlapPolicy = "skip" | "queue" | "parallel";
export type ScheduleMisfirePolicy = "skip" | "run_once";

export interface ScheduleRetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  retryableCodes?: string[];
}

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
      projectId?: string;
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
      projectId?: string;
      sessionId?: string;
      inputs?: Record<string, unknown>;
    };

export interface ScheduleRun {
  id: string;
  scheduleId: string;
  status: ScheduleRunStatus;
  scheduledFor: string;
  startedAt?: string;
  finishedAt?: string;
  agentRunId?: string;
  workflowRunId?: string;
  error?: string;
  reason?: string;
  attempts?: number;
}

export interface Schedule {
  id: string;
  name: string;
  status: ScheduleStatus;
  trigger: ScheduleTrigger;
  action: ScheduleAction;
  overlapPolicy: ScheduleOverlapPolicy;
  misfirePolicy: ScheduleMisfirePolicy;
  retryPolicy?: ScheduleRetryPolicy;
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
  overlapPolicy?: ScheduleOverlapPolicy;
  misfirePolicy?: ScheduleMisfirePolicy;
  retryPolicy?: ScheduleRetryPolicy;
}

export interface UpdateScheduleRequest {
  name?: string;
  trigger?: ScheduleTrigger;
  action?: ScheduleAction;
  overlapPolicy?: ScheduleOverlapPolicy;
  misfirePolicy?: ScheduleMisfirePolicy;
  retryPolicy?: ScheduleRetryPolicy | null;
}

export interface CreateSessionRequest {
  projectId?: string;
  cwd?: string;
  name?: string;
  sessionFile?: string;
  continueRecent?: boolean;
  model?: PromptRequest["model"];
  thinkingLevel?: ThinkingLevel;
  tools?: string[];
  persist?: boolean;
}

export interface SchedulesResponse {
  schedules: Schedule[];
}

export interface ScheduleResponse {
  schedule: Schedule;
}

export interface ScheduleRunsResponse {
  runs: ScheduleRun[];
}

export interface ScheduleRunResponse {
  run: ScheduleRun;
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
    resourceDiagnostics: ResourceDiagnostic[];
    packages: string[];
    blockedPackages: string[];
    stores: StoreDiagnostic[];
    workflowBackend: WorkflowBackendInfo;
  };
  gaps: string[];
}

export interface StoreDiagnostic {
  name: string;
  path: string;
  ok: boolean;
  exists: boolean;
  recordCount: number;
  recovered: boolean;
  backupPath?: string;
  error?: string;
}

export interface ResourceCollision {
  resourceType: "extension" | "skill" | "prompt" | "theme";
  name: string;
  winnerPath: string;
  loserPath: string;
  winnerSource?: string;
  loserSource?: string;
}

export interface ResourceDiagnostic {
  type: "warning" | "error" | "collision";
  message: string;
  path?: string;
  collision?: ResourceCollision;
}

export interface PackagesResponse {
  packages: PackageSummary[];
}

export interface PackageInstallResponse extends PackagesResponse {
  operation: PackageOperation;
}

export interface PackageOperationStartResponse extends PackagesResponse {
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
export type PackageTrustStatus = "trusted" | "untrusted";
export type PackageLoadStatus = "enabled" | "blocked";
export type PackageOperationAction = "install" | "remove" | "update";
export type PackageOperationStatus = "running" | "done" | "error";
export type PackageProgressAction = "install" | "remove" | "update" | "clone" | "pull";
export type PackageProgressEventType = "start" | "progress" | "complete" | "error";

export interface PackageSummary {
  source: string;
  scope: PackageScope;
  filtered: boolean;
  installedPath?: string;
  status: PackageStatus;
  trustStatus: PackageTrustStatus;
  trusted: boolean;
  trustedAt?: string;
  loadStatus: PackageLoadStatus;
  blockedReason?: string;
}

export interface PackageTrustRecord {
  source: string;
  status: PackageTrustStatus;
  trustedAt?: string;
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
    retryable: boolean;
    code?: string;
    details?: unknown;
  };
}
