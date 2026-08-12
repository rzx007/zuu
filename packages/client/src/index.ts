import type {
  Diagnostics,
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
  PackageOperationResponse,
  PackageOperationsResponse,
  PackagesResponse,
  ModelsResponse,
  PromptRequest,
  PromptStreamEvent,
  RunResponse,
  RunsResponse,
  ResolveApprovalRequest,
  CreateScheduleRequest,
  ScheduleResponse,
  SchedulesResponse,
  SessionActionResponse,
  SessionResponse,
  SessionsResponse,
  SessionTreeResponse,
  StartWorkflowRequest,
  StoredSessionsResponse,
  SwitchSessionRequest,
  WorkflowRunResponse,
  WorkflowRunsResponse,
  WorkflowsResponse,
} from "./protocol";

export type * from "./protocol";

export interface ZuuClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  apiToken?: string;
}

export interface PromptStreamOptions {
  signal?: AbortSignal;
}

export interface ZuuClient {
  health(): Promise<HealthResponse>;
  diagnostics(): Promise<Diagnostics>;
  listPackages(): Promise<PackagesResponse>;
  listModels(): Promise<ModelsResponse>;
  addPackage(input: PackageMutationRequest): Promise<PackagesResponse>;
  installPackage(input: PackageMutationRequest): Promise<PackageInstallResponse>;
  removePackage(input: PackageMutationRequest): Promise<PackagesResponse>;
  listPackageOperations(): Promise<PackageOperationsResponse>;
  getPackageOperation(operationId: string): Promise<PackageOperationResponse>;
  listSessions(): Promise<SessionsResponse>;
  listStoredSessions(cwd?: string): Promise<StoredSessionsResponse>;
  getSessionTree(sessionId: string): Promise<SessionTreeResponse>;
  listRuns(sessionId?: string): Promise<RunsResponse>;
  getRun(runId: string): Promise<RunResponse>;
  listWorkflows(): Promise<WorkflowsResponse>;
  startWorkflow(workflowId: string, input?: StartWorkflowRequest): Promise<WorkflowRunResponse>;
  listWorkflowRuns(): Promise<WorkflowRunsResponse>;
  getWorkflowRun(runId: string): Promise<WorkflowRunResponse>;
  abortWorkflowRun(runId: string): Promise<WorkflowRunResponse>;
  listSchedules(): Promise<SchedulesResponse>;
  createSchedule(input: CreateScheduleRequest): Promise<ScheduleResponse>;
  getSchedule(scheduleId: string): Promise<ScheduleResponse>;
  pauseSchedule(scheduleId: string): Promise<ScheduleResponse>;
  resumeSchedule(scheduleId: string): Promise<ScheduleResponse>;
  triggerSchedule(scheduleId: string): Promise<ScheduleResponse>;
  deleteSchedule(scheduleId: string): Promise<ScheduleResponse>;
  listApprovals(status?: ApprovalStatus): Promise<ApprovalsResponse>;
  getApproval(approvalId: string): Promise<ApprovalResponse>;
  resolveApproval(approvalId: string, input: ResolveApprovalRequest): Promise<ApprovalResponse>;
  createSession(input?: Record<string, unknown>): Promise<SessionResponse>;
  openSession(input: OpenSessionRequest): Promise<SessionResponse>;
  prompt(input: PromptRequest, options?: PromptStreamOptions): AsyncGenerator<PromptStreamEvent>;
  abort(sessionId: string): Promise<SessionResponse>;
  compact(sessionId: string, instructions?: string): Promise<SessionResponse>;
  newSession(sessionId: string, input?: NewSessionRequest): Promise<SessionActionResponse>;
  switchSession(sessionId: string, input: SwitchSessionRequest): Promise<SessionActionResponse>;
  forkSession(sessionId: string, input: ForkSessionRequest): Promise<SessionActionResponse>;
  importSession(sessionId: string, input: ImportSessionRequest): Promise<SessionActionResponse>;
}

function joinUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  return `${normalizedBase}${path}`;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: { message?: string } }).error?.message ?? response.statusText)
        : response.statusText;
    throw new Error(message);
  }

  return data as T;
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
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");

    if (data) events.push(JSON.parse(data) as PromptStreamEvent);
  }

  return { events, rest };
}

export function createZuuClient(options: ZuuClientOptions = {}): ZuuClient {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? "";
  const apiToken = options.apiToken;

  return {
    health: () => requestJson<HealthResponse>(fetchImpl, baseUrl, "/api/health", undefined, apiToken),
    diagnostics: () => requestJson<Diagnostics>(fetchImpl, baseUrl, "/api/diagnostics", undefined, apiToken),
    listPackages: () => requestJson<PackagesResponse>(fetchImpl, baseUrl, "/api/packages", undefined, apiToken),
    listModels: () => requestJson<ModelsResponse>(fetchImpl, baseUrl, "/api/models", undefined, apiToken),
    addPackage: (input) =>
      requestJson<PackagesResponse>(fetchImpl, baseUrl, "/api/packages", {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    installPackage: (input) =>
      requestJson<PackageInstallResponse>(fetchImpl, baseUrl, "/api/packages/install", {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    removePackage: (input) =>
      requestJson<PackagesResponse>(fetchImpl, baseUrl, "/api/packages", {
        method: "DELETE",
        body: JSON.stringify(input),
      }, apiToken),
    listPackageOperations: () =>
      requestJson<PackageOperationsResponse>(fetchImpl, baseUrl, "/api/package-operations", undefined, apiToken),
    getPackageOperation: (operationId) =>
      requestJson<PackageOperationResponse>(
        fetchImpl,
        baseUrl,
        `/api/package-operations/${encodeURIComponent(operationId)}`,
        undefined,
        apiToken,
      ),
    listSessions: () => requestJson<SessionsResponse>(fetchImpl, baseUrl, "/api/sessions", undefined, apiToken),
    listStoredSessions: (cwd) =>
      requestJson<StoredSessionsResponse>(
        fetchImpl,
        baseUrl,
        cwd ? `/api/session-files?cwd=${encodeURIComponent(cwd)}` : "/api/session-files",
        undefined,
        apiToken,
      ),
    getSessionTree: (sessionId) =>
      requestJson<SessionTreeResponse>(fetchImpl, baseUrl, `/api/sessions/${encodeURIComponent(sessionId)}/tree`, undefined, apiToken),
    listRuns: (sessionId) =>
      requestJson<RunsResponse>(
        fetchImpl,
        baseUrl,
        sessionId ? `/api/runs?sessionId=${encodeURIComponent(sessionId)}` : "/api/runs",
        undefined,
        apiToken,
      ),
    getRun: (runId) => requestJson<RunResponse>(fetchImpl, baseUrl, `/api/runs/${encodeURIComponent(runId)}`, undefined, apiToken),
    listWorkflows: () => requestJson<WorkflowsResponse>(fetchImpl, baseUrl, "/api/workflows", undefined, apiToken),
    startWorkflow: (workflowId, input = {}) =>
      requestJson<WorkflowRunResponse>(fetchImpl, baseUrl, `/api/workflows/${encodeURIComponent(workflowId)}/runs`, {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    listWorkflowRuns: () =>
      requestJson<WorkflowRunsResponse>(fetchImpl, baseUrl, "/api/workflow-runs", undefined, apiToken),
    getWorkflowRun: (runId) =>
      requestJson<WorkflowRunResponse>(fetchImpl, baseUrl, `/api/workflow-runs/${encodeURIComponent(runId)}`, undefined, apiToken),
    abortWorkflowRun: (runId) =>
      requestJson<WorkflowRunResponse>(fetchImpl, baseUrl, `/api/workflow-runs/${encodeURIComponent(runId)}/abort`, {
        method: "POST",
      }, apiToken),
    listSchedules: () => requestJson<SchedulesResponse>(fetchImpl, baseUrl, "/api/schedules", undefined, apiToken),
    createSchedule: (input) =>
      requestJson<ScheduleResponse>(fetchImpl, baseUrl, "/api/schedules", {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    getSchedule: (scheduleId) =>
      requestJson<ScheduleResponse>(fetchImpl, baseUrl, `/api/schedules/${encodeURIComponent(scheduleId)}`, undefined, apiToken),
    pauseSchedule: (scheduleId) =>
      requestJson<ScheduleResponse>(fetchImpl, baseUrl, `/api/schedules/${encodeURIComponent(scheduleId)}/pause`, {
        method: "POST",
      }, apiToken),
    resumeSchedule: (scheduleId) =>
      requestJson<ScheduleResponse>(fetchImpl, baseUrl, `/api/schedules/${encodeURIComponent(scheduleId)}/resume`, {
        method: "POST",
      }, apiToken),
    triggerSchedule: (scheduleId) =>
      requestJson<ScheduleResponse>(fetchImpl, baseUrl, `/api/schedules/${encodeURIComponent(scheduleId)}/trigger`, {
        method: "POST",
      }, apiToken),
    deleteSchedule: (scheduleId) =>
      requestJson<ScheduleResponse>(fetchImpl, baseUrl, `/api/schedules/${encodeURIComponent(scheduleId)}`, {
        method: "DELETE",
      }, apiToken),
    listApprovals: (status) =>
      requestJson<ApprovalsResponse>(
        fetchImpl,
        baseUrl,
        status ? `/api/approvals?status=${encodeURIComponent(status)}` : "/api/approvals",
        undefined,
        apiToken,
      ),
    getApproval: (approvalId) =>
      requestJson<ApprovalResponse>(fetchImpl, baseUrl, `/api/approvals/${encodeURIComponent(approvalId)}`, undefined, apiToken),
    resolveApproval: (approvalId, input) =>
      requestJson<ApprovalResponse>(fetchImpl, baseUrl, `/api/approvals/${encodeURIComponent(approvalId)}/resolve`, {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    createSession: (input = {}) =>
      requestJson<SessionResponse>(fetchImpl, baseUrl, "/api/sessions", {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    openSession: (input) =>
      requestJson<SessionResponse>(fetchImpl, baseUrl, "/api/sessions/open", {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    abort: (sessionId) =>
      requestJson<SessionResponse>(fetchImpl, baseUrl, `/api/sessions/${encodeURIComponent(sessionId)}/abort`, {
        method: "POST",
      }, apiToken),
    compact: (sessionId, instructions) =>
      requestJson<SessionResponse>(fetchImpl, baseUrl, `/api/sessions/${encodeURIComponent(sessionId)}/compact`, {
        method: "POST",
        body: JSON.stringify({ instructions }),
      }, apiToken),
    newSession: (sessionId, input = {}) =>
      requestJson<SessionActionResponse>(fetchImpl, baseUrl, `/api/sessions/${encodeURIComponent(sessionId)}/new`, {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    switchSession: (sessionId, input) =>
      requestJson<SessionActionResponse>(fetchImpl, baseUrl, `/api/sessions/${encodeURIComponent(sessionId)}/switch`, {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    forkSession: (sessionId, input) =>
      requestJson<SessionActionResponse>(fetchImpl, baseUrl, `/api/sessions/${encodeURIComponent(sessionId)}/fork`, {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    importSession: (sessionId, input) =>
      requestJson<SessionActionResponse>(fetchImpl, baseUrl, `/api/sessions/${encodeURIComponent(sessionId)}/import`, {
        method: "POST",
        body: JSON.stringify(input),
      }, apiToken),
    async *prompt(input, options = {}) {
      const response = await fetchImpl(joinUrl(baseUrl, "/api/prompt"), {
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
    },
  };
}
