import type {
  CreateProjectRequest,
  CreateScheduleRequest,
  CreateSessionRequest,
  Diagnostics,
  EventStreamQuery,
  ForkSessionRequest,
  HealthResponse,
  ImportSessionRequest,
  NewSessionRequest,
  OpenSessionRequest,
  ApprovalResponse,
  ApprovalStatus,
  ApprovalsResponse,
  PackageMutationRequest,
  PackageInstallResponse,
  PackageOperationStartResponse,
  PackageOperationResponse,
  PackageOperationsResponse,
  PackagesResponse,
  PromptRequest,
  PromptStreamEvent,
  ProjectResponse,
  ProjectsResponse,
  ModelsResponse,
  ModelSmokeRequest,
  ModelSmokeResponse,
  RunResponse,
  RunEventsResponse,
  RunsResponse,
  ResolveApprovalRequest,
  ScheduleResponse,
  ScheduleRunResponse,
  ScheduleRunsResponse,
  SchedulesResponse,
  SessionActionResponse,
  SessionResponse,
  SessionsResponse,
  SessionTreeResponse,
  StartWorkflowRequest,
  StoredSessionsResponse,
  SwitchSessionRequest,
  UpdateProjectRequest,
  UpdateScheduleRequest,
  UpdateSessionRequest,
  WorkflowArtifactResponse,
  WorkflowRunResponse,
  WorkflowRunsResponse,
  WorkflowStagesResponse,
  WorkflowTasksResponse,
  WorkflowsResponse,
  ApiErrorResponse,
  AuthRotateResponse,
  AuthStatusResponse,
  AuditEventsQuery,
  AuditEventsResponse,
} from "./protocol.js";

export type * from "./protocol.js";

export interface ZuuClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  apiToken?: string;
}

export interface PromptStreamOptions {
  signal?: AbortSignal;
}

export interface EventStreamOptions extends EventStreamQuery {
  signal?: AbortSignal;
  reconnect?: boolean;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  onOpen?: () => void;
  onReconnect?: (attempt: number, afterEventId: string | undefined) => void;
}

export interface ZuuClient {
  health(): Promise<HealthResponse>;
  authStatus(): Promise<AuthStatusResponse>;
  rotateAuthToken(): Promise<AuthRotateResponse>;
  listAuditEvents(query?: number | AuditEventsQuery): Promise<AuditEventsResponse>;
  diagnostics(): Promise<Diagnostics>;
  listPackages(): Promise<PackagesResponse>;
  listModels(): Promise<ModelsResponse>;
  smokeModel(input?: ModelSmokeRequest): Promise<ModelSmokeResponse>;
  listProjects(): Promise<ProjectsResponse>;
  createProject(input: CreateProjectRequest): Promise<ProjectResponse>;
  getProject(projectId: string): Promise<ProjectResponse>;
  updateProject(projectId: string, input: UpdateProjectRequest): Promise<ProjectResponse>;
  deleteProject(projectId: string): Promise<ProjectResponse>;
  listProjectSessions(projectId: string): Promise<SessionsResponse>;
  createProjectSession(projectId: string, input?: Omit<CreateSessionRequest, "projectId">): Promise<SessionResponse>;
  getProjectSession(projectId: string, sessionId: string): Promise<SessionResponse>;
  updateProjectSession(projectId: string, sessionId: string, input: UpdateSessionRequest): Promise<SessionResponse>;
  deleteProjectSession(projectId: string, sessionId: string): Promise<SessionResponse>;
  listProjectStoredSessions(projectId: string): Promise<StoredSessionsResponse>;
  openProjectSession(projectId: string, input: Omit<OpenSessionRequest, "projectId">): Promise<SessionResponse>;
  listProjectRuns(projectId: string, sessionId?: string): Promise<RunsResponse>;
  getProjectRun(projectId: string, runId: string): Promise<RunResponse>;
  abortProjectRun(projectId: string, runId: string): Promise<RunResponse>;
  listProjectRunEvents(projectId: string, runId: string, afterEventId?: string): Promise<RunEventsResponse>;
  listProjectWorkflows(projectId: string): Promise<WorkflowsResponse>;
  startProjectWorkflow(
    projectId: string,
    workflowId: string,
    input?: Omit<StartWorkflowRequest, "projectId">,
  ): Promise<WorkflowRunResponse>;
  listProjectWorkflowRuns(projectId: string): Promise<WorkflowRunsResponse>;
  getProjectWorkflowRun(projectId: string, runId: string): Promise<WorkflowRunResponse>;
  listProjectWorkflowStages(projectId: string, runId: string): Promise<WorkflowStagesResponse>;
  listProjectWorkflowTasks(projectId: string, runId: string): Promise<WorkflowTasksResponse>;
  getProjectWorkflowArtifact(projectId: string, artifactId: string): Promise<WorkflowArtifactResponse>;
  abortProjectWorkflowRun(projectId: string, runId: string): Promise<WorkflowRunResponse>;
  listProjectSchedules(projectId: string): Promise<SchedulesResponse>;
  createProjectSchedule(projectId: string, input: CreateScheduleRequest): Promise<ScheduleResponse>;
  getProjectSchedule(projectId: string, scheduleId: string): Promise<ScheduleResponse>;
  updateProjectSchedule(projectId: string, scheduleId: string, input: UpdateScheduleRequest): Promise<ScheduleResponse>;
  listProjectScheduleRuns(projectId: string, scheduleId: string): Promise<ScheduleRunsResponse>;
  getProjectScheduleRun(projectId: string, runId: string): Promise<ScheduleRunResponse>;
  abortProjectScheduleRun(projectId: string, runId: string): Promise<ScheduleRunResponse>;
  pauseProjectSchedule(projectId: string, scheduleId: string): Promise<ScheduleResponse>;
  resumeProjectSchedule(projectId: string, scheduleId: string): Promise<ScheduleResponse>;
  triggerProjectSchedule(projectId: string, scheduleId: string): Promise<ScheduleResponse>;
  deleteProjectSchedule(projectId: string, scheduleId: string): Promise<ScheduleResponse>;
  addPackage(input: PackageMutationRequest): Promise<PackagesResponse>;
  installPackage(input: PackageMutationRequest): Promise<PackageInstallResponse>;
  updatePackage(input: PackageMutationRequest): Promise<PackageOperationStartResponse>;
  removePackage(input: PackageMutationRequest): Promise<PackageOperationStartResponse>;
  trustPackage(input: PackageMutationRequest): Promise<PackagesResponse>;
  revokePackageTrust(input: PackageMutationRequest): Promise<PackagesResponse>;
  listPackageOperations(): Promise<PackageOperationsResponse>;
  getPackageOperation(operationId: string): Promise<PackageOperationResponse>;
  listSessions(projectId?: string): Promise<SessionsResponse>;
  listStoredSessions(cwd?: string, projectId?: string): Promise<StoredSessionsResponse>;
  getSessionTree(sessionId: string): Promise<SessionTreeResponse>;
  listRuns(sessionId?: string, projectId?: string): Promise<RunsResponse>;
  getRun(runId: string): Promise<RunResponse>;
  abortRun(runId: string): Promise<RunResponse>;
  listRunEvents(runId: string, afterEventId?: string): Promise<RunEventsResponse>;
  listWorkflows(): Promise<WorkflowsResponse>;
  startWorkflow(workflowId: string, input?: StartWorkflowRequest): Promise<WorkflowRunResponse>;
  listWorkflowRuns(projectId?: string): Promise<WorkflowRunsResponse>;
  getWorkflowRun(runId: string): Promise<WorkflowRunResponse>;
  listWorkflowStages(runId: string): Promise<WorkflowStagesResponse>;
  listWorkflowTasks(runId: string): Promise<WorkflowTasksResponse>;
  getWorkflowArtifact(artifactId: string): Promise<WorkflowArtifactResponse>;
  abortWorkflowRun(runId: string): Promise<WorkflowRunResponse>;
  listSchedules(projectId?: string): Promise<SchedulesResponse>;
  createSchedule(input: CreateScheduleRequest): Promise<ScheduleResponse>;
  getSchedule(scheduleId: string): Promise<ScheduleResponse>;
  updateSchedule(scheduleId: string, input: UpdateScheduleRequest): Promise<ScheduleResponse>;
  listScheduleRuns(scheduleId: string): Promise<ScheduleRunsResponse>;
  getScheduleRun(runId: string): Promise<ScheduleRunResponse>;
  abortScheduleRun(runId: string): Promise<ScheduleRunResponse>;
  pauseSchedule(scheduleId: string): Promise<ScheduleResponse>;
  resumeSchedule(scheduleId: string): Promise<ScheduleResponse>;
  triggerSchedule(scheduleId: string): Promise<ScheduleResponse>;
  deleteSchedule(scheduleId: string): Promise<ScheduleResponse>;
  listApprovals(status?: ApprovalStatus): Promise<ApprovalsResponse>;
  getApproval(approvalId: string): Promise<ApprovalResponse>;
  resolveApproval(approvalId: string, input: ResolveApprovalRequest): Promise<ApprovalResponse>;
  createSession(input?: CreateSessionRequest): Promise<SessionResponse>;
  getSession(sessionId: string, projectId?: string): Promise<SessionResponse>;
  updateSession(sessionId: string, input: UpdateSessionRequest, projectId?: string): Promise<SessionResponse>;
  deleteSession(sessionId: string, projectId?: string): Promise<SessionResponse>;
  openSession(input: OpenSessionRequest): Promise<SessionResponse>;
  prompt(input: PromptRequest, options?: PromptStreamOptions): AsyncGenerator<PromptStreamEvent>;
  promptSession(
    sessionId: string,
    input: Omit<PromptRequest, "sessionId" | "streamingBehavior">,
    options?: PromptStreamOptions,
  ): AsyncGenerator<PromptStreamEvent>;
  steerSession(
    sessionId: string,
    input: Omit<PromptRequest, "sessionId" | "streamingBehavior">,
    options?: PromptStreamOptions,
  ): AsyncGenerator<PromptStreamEvent>;
  followUpSession(
    sessionId: string,
    input: Omit<PromptRequest, "sessionId" | "streamingBehavior">,
    options?: PromptStreamOptions,
  ): AsyncGenerator<PromptStreamEvent>;
  subscribeEvents(options?: EventStreamOptions): AsyncGenerator<PromptStreamEvent>;
  abort(sessionId: string): Promise<SessionResponse>;
  compact(sessionId: string, instructions?: string): Promise<SessionResponse>;
  newSession(sessionId: string, input?: NewSessionRequest): Promise<SessionActionResponse>;
  switchSession(sessionId: string, input: SwitchSessionRequest): Promise<SessionActionResponse>;
  forkSession(sessionId: string, input: ForkSessionRequest): Promise<SessionActionResponse>;
  importSession(sessionId: string, input: ImportSessionRequest): Promise<SessionActionResponse>;
}

export class ZuuClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(message: string, options: { status: number; retryable?: boolean; code?: string; details?: unknown }) {
    super(message);
    this.name = "ZuuClientError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.retryable = options.retryable ?? false;
  }
}

function joinUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  return `${normalizedBase}${path}`;
}

function withQuery(path: string, query: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  return params.size ? `${path}?${params}` : path;
}

function withAuditQuery(query: number | AuditEventsQuery | undefined) {
  if (typeof query === "number") return withQuery("/v1/audit-events", { limit: String(query) });
  return withQuery("/v1/audit-events", {
    limit: query?.limit === undefined ? undefined : String(query.limit),
    action: query?.action,
    outcome: query?.outcome,
    target: query?.target,
    authScope: query?.authScope,
    since: query?.since,
    until: query?.until,
  });
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = parseJson(text);

  if (!response.ok) {
    const error = isApiErrorResponse(data) ? data.error : undefined;
    throw new ZuuClientError(String(error?.message ?? response.statusText), {
      status: error?.status ?? response.status,
      retryable: error?.retryable,
      code: error?.code,
      details: error?.details,
    });
  }

  return data as T;
}

function parseJson(text: string) {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      "error" in value &&
      value.error &&
      typeof value.error === "object" &&
      "message" in value.error,
  );
}

function isPromptStreamEvent(value: unknown): value is PromptStreamEvent {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      typeof value.id === "string" &&
      "createdAt" in value &&
      typeof value.createdAt === "string" &&
      "runId" in value &&
      typeof value.runId === "string" &&
      "type" in value &&
      typeof value.type === "string",
  );
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

async function requestJson<T>(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  init?: RequestInit,
  apiToken?: string,
): Promise<T> {
  const response = await fetchImpl(joinUrl(baseUrl, path), {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}),
      ...init?.headers,
    },
  });

  return parseJsonResponse<T>(response);
}

function parseSseEvents(buffer: string) {
  const frames = buffer.split("\n\n");
  const rest = frames.pop() ?? "";
  const events: PromptStreamEvent[] = [];

  for (const frame of frames) {
    const eventName = frame
      .split("\n")
      .find((line) => line.startsWith("event:"))
      ?.slice(6)
      .trimStart();
    if (eventName === "heartbeat") continue;

    const id = frame
      .split("\n")
      .find((line) => line.startsWith("id:"))
      ?.slice(3)
      .trimStart();
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");

    if (data) {
      const event = JSON.parse(data) as unknown;
      if (!id || !isPromptStreamEvent(event) || event.id !== id) {
        throw new Error("Invalid SSE event frame");
      }
      events.push(event);
    }
  }

  return { events, rest };
}

export function createZuuClient(options: ZuuClientOptions = {}): ZuuClient {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? "";
  const apiToken = options.apiToken;

  return {
    health: () => requestJson<HealthResponse>(fetchImpl, baseUrl, "/v1/health", undefined, apiToken),
    authStatus: () => requestJson<AuthStatusResponse>(fetchImpl, baseUrl, "/v1/auth/status", undefined, apiToken),
    rotateAuthToken: () =>
      requestJson<AuthRotateResponse>(fetchImpl, baseUrl, "/v1/auth/rotate", {
        method: "POST",
      }, apiToken),
    listAuditEvents: (query) =>
      requestJson<AuditEventsResponse>(
        fetchImpl,
        baseUrl,
        withAuditQuery(query),
        undefined,
        apiToken,
      ),
    diagnostics: () => requestJson<Diagnostics>(fetchImpl, baseUrl, "/v1/diagnostics", undefined, apiToken),
    listPackages: () => requestJson<PackagesResponse>(fetchImpl, baseUrl, "/v1/packages", undefined, apiToken),
    listModels: () => requestJson<ModelsResponse>(fetchImpl, baseUrl, "/v1/models", undefined, apiToken),
    smokeModel: (input = {}) =>
      requestJson<ModelSmokeResponse>(fetchImpl, baseUrl, "/v1/models/smoke", {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    listProjects: () => requestJson<ProjectsResponse>(fetchImpl, baseUrl, "/v1/projects", undefined, apiToken),
    createProject: (input) =>
      requestJson<ProjectResponse>(fetchImpl, baseUrl, "/v1/projects", {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    getProject: (projectId) =>
      requestJson<ProjectResponse>(fetchImpl, baseUrl, `/v1/projects/${encodeURIComponent(projectId)}`, undefined, apiToken),
    updateProject: (projectId, input) =>
      requestJson<ProjectResponse>(fetchImpl, baseUrl, `/v1/projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }, apiToken),
    deleteProject: (projectId) =>
      requestJson<ProjectResponse>(fetchImpl, baseUrl, `/v1/projects/${encodeURIComponent(projectId)}`, {
        method: "DELETE",
      }, apiToken),
    listProjectSessions: (projectId) =>
      requestJson<SessionsResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/sessions`,
        undefined,
        apiToken,
      ),
    createProjectSession: (projectId, input = {}) =>
      requestJson<SessionResponse>(fetchImpl, baseUrl, `/v1/projects/${encodeURIComponent(projectId)}/sessions`, {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    getProjectSession: (projectId, sessionId) =>
      requestJson<SessionResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}`,
        undefined,
        apiToken,
      ),
    updateProjectSession: (projectId, sessionId, input) =>
      requestJson<SessionResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
        apiToken,
      ),
    deleteProjectSession: (projectId, sessionId) =>
      requestJson<SessionResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}`,
        { method: "DELETE" },
        apiToken,
      ),
    listProjectStoredSessions: (projectId) =>
      requestJson<StoredSessionsResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/session-files`,
        undefined,
        apiToken,
      ),
    openProjectSession: (projectId, input) =>
      requestJson<SessionResponse>(fetchImpl, baseUrl, `/v1/projects/${encodeURIComponent(projectId)}/sessions/open`, {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    listProjectRuns: (projectId, sessionId) =>
      requestJson<RunsResponse>(
        fetchImpl,
        baseUrl,
        withQuery(`/v1/projects/${encodeURIComponent(projectId)}/runs`, { sessionId }),
        undefined,
        apiToken,
      ),
    getProjectRun: (projectId, runId) =>
      requestJson<RunResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`,
        undefined,
        apiToken,
      ),
    abortProjectRun: (projectId, runId) =>
      requestJson<RunResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/abort`,
        { method: "POST" },
        apiToken,
      ),
    listProjectRunEvents: (projectId, runId, afterEventId) =>
      requestJson<RunEventsResponse>(
        fetchImpl,
        baseUrl,
        withQuery(`/v1/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/events`, {
          afterEventId,
        }),
        undefined,
        apiToken,
      ),
    listProjectWorkflows: (projectId) =>
      requestJson<WorkflowsResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/workflows`,
        undefined,
        apiToken,
      ),
    startProjectWorkflow: (projectId, workflowId, input = {}) =>
      requestJson<WorkflowRunResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowId)}/runs`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
        apiToken,
      ),
    listProjectWorkflowRuns: (projectId) =>
      requestJson<WorkflowRunsResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/workflow-runs`,
        undefined,
        apiToken,
      ),
    getProjectWorkflowRun: (projectId, runId) =>
      requestJson<WorkflowRunResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/workflow-runs/${encodeURIComponent(runId)}`,
        undefined,
        apiToken,
      ),
    listProjectWorkflowStages: (projectId, runId) =>
      requestJson<WorkflowStagesResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/workflow-runs/${encodeURIComponent(runId)}/stages`,
        undefined,
        apiToken,
      ),
    listProjectWorkflowTasks: (projectId, runId) =>
      requestJson<WorkflowTasksResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/workflow-runs/${encodeURIComponent(runId)}/tasks`,
        undefined,
        apiToken,
      ),
    getProjectWorkflowArtifact: (projectId, artifactId) =>
      requestJson<WorkflowArtifactResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}`,
        undefined,
        apiToken,
      ),
    abortProjectWorkflowRun: (projectId, runId) =>
      requestJson<WorkflowRunResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/workflow-runs/${encodeURIComponent(runId)}/abort`,
        { method: "POST" },
        apiToken,
      ),
    listProjectSchedules: (projectId) =>
      requestJson<SchedulesResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/schedules`,
        undefined,
        apiToken,
      ),
    createProjectSchedule: (projectId, input) =>
      requestJson<ScheduleResponse>(fetchImpl, baseUrl, `/v1/projects/${encodeURIComponent(projectId)}/schedules`, {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    getProjectSchedule: (projectId, scheduleId) =>
      requestJson<ScheduleResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/schedules/${encodeURIComponent(scheduleId)}`,
        undefined,
        apiToken,
      ),
    updateProjectSchedule: (projectId, scheduleId, input) =>
      requestJson<ScheduleResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/schedules/${encodeURIComponent(scheduleId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
        apiToken,
      ),
    listProjectScheduleRuns: (projectId, scheduleId) =>
      requestJson<ScheduleRunsResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/schedules/${encodeURIComponent(scheduleId)}/runs`,
        undefined,
        apiToken,
      ),
    getProjectScheduleRun: (projectId, runId) =>
      requestJson<ScheduleRunResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/schedule-runs/${encodeURIComponent(runId)}`,
        undefined,
        apiToken,
      ),
    abortProjectScheduleRun: (projectId, runId) =>
      requestJson<ScheduleRunResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/schedule-runs/${encodeURIComponent(runId)}/abort`,
        { method: "POST" },
        apiToken,
      ),
    pauseProjectSchedule: (projectId, scheduleId) =>
      requestJson<ScheduleResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/schedules/${encodeURIComponent(scheduleId)}/pause`,
        { method: "POST" },
        apiToken,
      ),
    resumeProjectSchedule: (projectId, scheduleId) =>
      requestJson<ScheduleResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/schedules/${encodeURIComponent(scheduleId)}/resume`,
        { method: "POST" },
        apiToken,
      ),
    triggerProjectSchedule: (projectId, scheduleId) =>
      requestJson<ScheduleResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/schedules/${encodeURIComponent(scheduleId)}/trigger`,
        { method: "POST" },
        apiToken,
      ),
    deleteProjectSchedule: (projectId, scheduleId) =>
      requestJson<ScheduleResponse>(
        fetchImpl,
        baseUrl,
        `/v1/projects/${encodeURIComponent(projectId)}/schedules/${encodeURIComponent(scheduleId)}`,
        { method: "DELETE" },
        apiToken,
      ),
    addPackage: (input) =>
      requestJson<PackagesResponse>(fetchImpl, baseUrl, "/v1/packages", {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    installPackage: (input) =>
      requestJson<PackageInstallResponse>(fetchImpl, baseUrl, "/v1/packages/install", {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    updatePackage: (input) =>
      requestJson<PackageOperationStartResponse>(fetchImpl, baseUrl, "/v1/packages/update", {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    removePackage: (input) =>
      requestJson<PackageOperationStartResponse>(fetchImpl, baseUrl, "/v1/packages", {
        method: "DELETE",
        body: JSON.stringify(input),
      }, apiToken),
    trustPackage: (input) =>
      requestJson<PackagesResponse>(fetchImpl, baseUrl, "/v1/packages/trust", {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    revokePackageTrust: (input) =>
      requestJson<PackagesResponse>(fetchImpl, baseUrl, "/v1/packages/trust", {
        method: "DELETE",
        body: JSON.stringify(input),
      }, apiToken),
    listPackageOperations: () =>
      requestJson<PackageOperationsResponse>(fetchImpl, baseUrl, "/v1/package-operations", undefined, apiToken),
    getPackageOperation: (operationId) =>
      requestJson<PackageOperationResponse>(
        fetchImpl,
        baseUrl,
        `/v1/package-operations/${encodeURIComponent(operationId)}`,
        undefined,
        apiToken,
      ),
    listSessions: (projectId) =>
      requestJson<SessionsResponse>(fetchImpl, baseUrl, withQuery("/v1/sessions", { projectId }), undefined, apiToken),
    listStoredSessions: (cwd, projectId) =>
      requestJson<StoredSessionsResponse>(
        fetchImpl,
        baseUrl,
        withQuery("/v1/session-files", { cwd, projectId }),
        undefined,
        apiToken,
      ),
    getSessionTree: (sessionId) =>
      requestJson<SessionTreeResponse>(fetchImpl, baseUrl, `/v1/sessions/${encodeURIComponent(sessionId)}/tree`, undefined, apiToken),
    listRuns: (sessionId, projectId) =>
      requestJson<RunsResponse>(
        fetchImpl,
        baseUrl,
        withQuery("/v1/runs", { sessionId, projectId }),
        undefined,
        apiToken,
      ),
    getRun: (runId) => requestJson<RunResponse>(fetchImpl, baseUrl, `/v1/runs/${encodeURIComponent(runId)}`, undefined, apiToken),
    abortRun: (runId) =>
      requestJson<RunResponse>(fetchImpl, baseUrl, `/v1/runs/${encodeURIComponent(runId)}/abort`, {
        method: "POST",
      }, apiToken),
    listRunEvents: (runId, afterEventId) =>
      requestJson<RunEventsResponse>(
        fetchImpl,
        baseUrl,
        afterEventId
          ? `/v1/runs/${encodeURIComponent(runId)}/events?afterEventId=${encodeURIComponent(afterEventId)}`
          : `/v1/runs/${encodeURIComponent(runId)}/events`,
        undefined,
        apiToken,
      ),
    listWorkflows: () => requestJson<WorkflowsResponse>(fetchImpl, baseUrl, "/v1/workflows", undefined, apiToken),
    startWorkflow: (workflowId, input = {}) =>
      requestJson<WorkflowRunResponse>(fetchImpl, baseUrl, `/v1/workflows/${encodeURIComponent(workflowId)}/runs`, {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    listWorkflowRuns: (projectId) =>
      requestJson<WorkflowRunsResponse>(
        fetchImpl,
        baseUrl,
        withQuery("/v1/workflow-runs", { projectId }),
        undefined,
        apiToken,
      ),
    getWorkflowRun: (runId) =>
      requestJson<WorkflowRunResponse>(fetchImpl, baseUrl, `/v1/workflow-runs/${encodeURIComponent(runId)}`, undefined, apiToken),
    listWorkflowStages: (runId) =>
      requestJson<WorkflowStagesResponse>(
        fetchImpl,
        baseUrl,
        `/v1/workflow-runs/${encodeURIComponent(runId)}/stages`,
        undefined,
        apiToken,
      ),
    listWorkflowTasks: (runId) =>
      requestJson<WorkflowTasksResponse>(
        fetchImpl,
        baseUrl,
        `/v1/workflow-runs/${encodeURIComponent(runId)}/tasks`,
        undefined,
        apiToken,
      ),
    getWorkflowArtifact: (artifactId) =>
      requestJson<WorkflowArtifactResponse>(
        fetchImpl,
        baseUrl,
        `/v1/artifacts/${encodeURIComponent(artifactId)}`,
        undefined,
        apiToken,
      ),
    abortWorkflowRun: (runId) =>
      requestJson<WorkflowRunResponse>(fetchImpl, baseUrl, `/v1/workflow-runs/${encodeURIComponent(runId)}/abort`, {
        method: "POST",
      }, apiToken),
    listSchedules: (projectId) =>
      requestJson<SchedulesResponse>(fetchImpl, baseUrl, withQuery("/v1/schedules", { projectId }), undefined, apiToken),
    createSchedule: (input) =>
      requestJson<ScheduleResponse>(fetchImpl, baseUrl, "/v1/schedules", {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    getSchedule: (scheduleId) =>
      requestJson<ScheduleResponse>(fetchImpl, baseUrl, `/v1/schedules/${encodeURIComponent(scheduleId)}`, undefined, apiToken),
    updateSchedule: (scheduleId, input) =>
      requestJson<ScheduleResponse>(fetchImpl, baseUrl, `/v1/schedules/${encodeURIComponent(scheduleId)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }, apiToken),
    listScheduleRuns: (scheduleId) =>
      requestJson<ScheduleRunsResponse>(
        fetchImpl,
        baseUrl,
        `/v1/schedules/${encodeURIComponent(scheduleId)}/runs`,
        undefined,
        apiToken,
      ),
    getScheduleRun: (runId) =>
      requestJson<ScheduleRunResponse>(fetchImpl, baseUrl, `/v1/schedule-runs/${encodeURIComponent(runId)}`, undefined, apiToken),
    abortScheduleRun: (runId) =>
      requestJson<ScheduleRunResponse>(fetchImpl, baseUrl, `/v1/schedule-runs/${encodeURIComponent(runId)}/abort`, {
        method: "POST",
      }, apiToken),
    pauseSchedule: (scheduleId) =>
      requestJson<ScheduleResponse>(fetchImpl, baseUrl, `/v1/schedules/${encodeURIComponent(scheduleId)}/pause`, {
        method: "POST",
      }, apiToken),
    resumeSchedule: (scheduleId) =>
      requestJson<ScheduleResponse>(fetchImpl, baseUrl, `/v1/schedules/${encodeURIComponent(scheduleId)}/resume`, {
        method: "POST",
      }, apiToken),
    triggerSchedule: (scheduleId) =>
      requestJson<ScheduleResponse>(fetchImpl, baseUrl, `/v1/schedules/${encodeURIComponent(scheduleId)}/trigger`, {
        method: "POST",
      }, apiToken),
    deleteSchedule: (scheduleId) =>
      requestJson<ScheduleResponse>(fetchImpl, baseUrl, `/v1/schedules/${encodeURIComponent(scheduleId)}`, {
        method: "DELETE",
      }, apiToken),
    listApprovals: (status) =>
      requestJson<ApprovalsResponse>(
        fetchImpl,
        baseUrl,
        status ? `/v1/approvals?status=${encodeURIComponent(status)}` : "/v1/approvals",
        undefined,
        apiToken,
      ),
    getApproval: (approvalId) =>
      requestJson<ApprovalResponse>(fetchImpl, baseUrl, `/v1/approvals/${encodeURIComponent(approvalId)}`, undefined, apiToken),
    resolveApproval: (approvalId, input) =>
      requestJson<ApprovalResponse>(fetchImpl, baseUrl, `/v1/approvals/${encodeURIComponent(approvalId)}/resolve`, {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    createSession: (input = {}) =>
      requestJson<SessionResponse>(fetchImpl, baseUrl, "/v1/sessions", {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    getSession: (sessionId, projectId) =>
      requestJson<SessionResponse>(
        fetchImpl,
        baseUrl,
        withQuery(`/v1/sessions/${encodeURIComponent(sessionId)}`, { projectId }),
        undefined,
        apiToken,
      ),
    updateSession: (sessionId, input, projectId) =>
      requestJson<SessionResponse>(
        fetchImpl,
        baseUrl,
        withQuery(`/v1/sessions/${encodeURIComponent(sessionId)}`, { projectId }),
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
        apiToken,
      ),
    deleteSession: (sessionId, projectId) =>
      requestJson<SessionResponse>(
        fetchImpl,
        baseUrl,
        withQuery(`/v1/sessions/${encodeURIComponent(sessionId)}`, { projectId }),
        { method: "DELETE" },
        apiToken,
      ),
    openSession: (input) =>
      requestJson<SessionResponse>(fetchImpl, baseUrl, "/v1/sessions/open", {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    abort: (sessionId) =>
      requestJson<SessionResponse>(fetchImpl, baseUrl, `/v1/sessions/${encodeURIComponent(sessionId)}/abort`, {
        method: "POST",
      }, apiToken),
    compact: (sessionId, instructions) =>
      requestJson<SessionResponse>(fetchImpl, baseUrl, `/v1/sessions/${encodeURIComponent(sessionId)}/compact`, {
        method: "POST",
        body: JSON.stringify({ instructions }),
      }, apiToken),
    newSession: (sessionId, input = {}) =>
      requestJson<SessionActionResponse>(fetchImpl, baseUrl, `/v1/sessions/${encodeURIComponent(sessionId)}/new`, {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    switchSession: (sessionId, input) =>
      requestJson<SessionActionResponse>(fetchImpl, baseUrl, `/v1/sessions/${encodeURIComponent(sessionId)}/switch`, {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    forkSession: (sessionId, input) =>
      requestJson<SessionActionResponse>(fetchImpl, baseUrl, `/v1/sessions/${encodeURIComponent(sessionId)}/fork`, {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    importSession: (sessionId, input) =>
      requestJson<SessionActionResponse>(fetchImpl, baseUrl, `/v1/sessions/${encodeURIComponent(sessionId)}/import`, {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    prompt: (input, options = {}) => streamPrompt(fetchImpl, baseUrl, apiToken, "/v1/prompt", input, options),
    promptSession: (sessionId, input, options = {}) =>
      streamPrompt(fetchImpl, baseUrl, apiToken, `/v1/sessions/${encodeURIComponent(sessionId)}/prompts`, input, options),
    steerSession: (sessionId, input, options = {}) =>
      streamPrompt(fetchImpl, baseUrl, apiToken, `/v1/sessions/${encodeURIComponent(sessionId)}/steer`, input, options),
    followUpSession: (sessionId, input, options = {}) =>
      streamPrompt(fetchImpl, baseUrl, apiToken, `/v1/sessions/${encodeURIComponent(sessionId)}/follow-ups`, input, options),
    subscribeEvents: (input = {}) => streamEvents(fetchImpl, baseUrl, apiToken, input),
  };
}

async function* streamPrompt(
  fetchImpl: typeof fetch,
  baseUrl: string,
  apiToken: string | undefined,
  path: string,
  input: PromptRequest | Omit<PromptRequest, "sessionId" | "streamingBehavior">,
  options: PromptStreamOptions,
): AsyncGenerator<PromptStreamEvent> {
  const response = await fetchImpl(joinUrl(baseUrl, path), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}),
    },
    body: JSON.stringify(input),
    signal: options.signal,
  });

  if (!response.ok || !response.body) {
    await parseJsonResponse(response);
    return;
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const parsed = parseSseEvents(buffer + value);
      buffer = parsed.rest;
      for (const event of parsed.events) {
        yield event;
      }
    }

    const parsed = parseSseEvents(`${buffer}\n\n`);
    for (const event of parsed.events) {
      yield event;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function* streamEvents(
  fetchImpl: typeof fetch,
  baseUrl: string,
  apiToken: string | undefined,
  options: EventStreamOptions,
): AsyncGenerator<PromptStreamEvent> {
  const reconnect = options.reconnect ?? true;
  const reconnectDelayMs = options.reconnectDelayMs ?? 500;
  const maxReconnectDelayMs = options.maxReconnectDelayMs ?? 5_000;
  const seenEventIds = new Set<string>();
  const seenEventOrder: string[] = [];
  let afterEventId = options.afterEventId;
  let attempt = 0;

  while (!options.signal?.aborted) {
    try {
      for await (const event of openEventStream(fetchImpl, baseUrl, apiToken, { ...options, afterEventId })) {
        afterEventId = event.id;
        attempt = 0;
        if (rememberEventId(seenEventIds, seenEventOrder, event.id)) {
          yield event;
        }
      }
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error)) return;
      if (!reconnect || (error instanceof ZuuClientError && !error.retryable)) throw error;
      attempt += 1;
      options.onReconnect?.(attempt, afterEventId);
      await waitForReconnect(backoffDelay(reconnectDelayMs, maxReconnectDelayMs, attempt), options.signal);
      continue;
    }

    if (!reconnect) return;
    attempt += 1;
    options.onReconnect?.(attempt, afterEventId);
    await waitForReconnect(backoffDelay(reconnectDelayMs, maxReconnectDelayMs, attempt), options.signal);
  }
}

async function* openEventStream(
  fetchImpl: typeof fetch,
  baseUrl: string,
  apiToken: string | undefined,
  options: EventStreamOptions,
): AsyncGenerator<PromptStreamEvent> {
  const params = new URLSearchParams();
  if (options.runId) params.set("runId", options.runId);
  if (options.sessionId) params.set("sessionId", options.sessionId);
  if (options.afterEventId) params.set("afterEventId", options.afterEventId);
  const path = params.size ? `/v1/events?${params}` : "/v1/events";
  const response = await fetchImpl(joinUrl(baseUrl, path), {
    headers: {
      ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}),
      ...(options.afterEventId ? { "last-event-id": options.afterEventId } : {}),
    },
    signal: options.signal,
  });

  if (!response.ok || !response.body) {
    await parseJsonResponse(response);
    return;
  }

  options.onOpen?.();
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const parsed = parseSseEvents(buffer + value);
      buffer = parsed.rest;
      for (const event of parsed.events) {
        yield event;
      }
    }

    const parsed = parseSseEvents(`${buffer}\n\n`);
    for (const event of parsed.events) {
      yield event;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function rememberEventId(seenEventIds: Set<string>, seenEventOrder: string[], eventId: string) {
  if (seenEventIds.has(eventId)) return false;
  seenEventIds.add(eventId);
  seenEventOrder.push(eventId);
  if (seenEventOrder.length > 1_024) {
    const expiredEventId = seenEventOrder.shift();
    if (expiredEventId) seenEventIds.delete(expiredEventId);
  }
  return true;
}

function backoffDelay(baseMs: number, maxMs: number, attempt: number) {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

function waitForReconnect(delayMs: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, delayMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}
