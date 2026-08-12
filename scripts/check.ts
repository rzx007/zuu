import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app, { auth } from "../src/index";
import { AuthService } from "../src/agent-daemon/auth-service";
import { AuditService } from "../src/agent-daemon/audit-service";
import { ApprovalStore } from "../src/agent-daemon/approval-store";
import { createApprovalExtension } from "../src/agent-daemon/approval-policy";
import { PackageService } from "../src/agent-daemon/packages";
import { PackageTrustStore } from "../src/agent-daemon/package-trust";
import { PromptService } from "../src/agent-daemon/prompt-service";
import { ProjectStore } from "../src/agent-daemon/projects";
import { RunEventStore } from "../src/agent-daemon/run-events";
import { loadRunHistory, saveRunHistory } from "../src/agent-daemon/run-history";
import { ScheduleStore } from "../src/agent-daemon/schedules";
import { createWorkflowBackend } from "../src/agent-daemon/workflows";
import { createZuuClient, ZuuClientError } from "@zuu/client";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { ApiError } from "../src/http";

const fetchFromApp: typeof fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  return app.fetch(request);
};

async function expectClientError(
  action: () => Promise<unknown>,
  expected: { status: number; code?: string; details?: (details: unknown) => boolean },
) {
  try {
    await action();
  } catch (error) {
    if (!(error instanceof ZuuClientError)) {
      throw new Error(`expected ZuuClientError, got ${error instanceof Error ? error.name : typeof error}`);
    }
    if (error.status !== expected.status) {
      throw new Error(`expected status ${expected.status}, got ${error.status}`);
    }
    if (expected.code && error.code !== expected.code) {
      throw new Error(`expected code ${expected.code}, got ${error.code}`);
    }
    if (expected.details && !expected.details(error.details)) {
      throw new Error("client error details did not match");
    }
    return error;
  }

  throw new Error("expected client call to fail");
}

async function drainStream(stream: AsyncGenerator<unknown>) {
  for await (const _event of stream) {
    // Exhaust the stream so client-side status and SSE parsing are exercised.
  }
}

async function main() {
  const currentApiToken = auth.currentToken();
  const authHeaders = () => ({ authorization: `Bearer ${currentApiToken}` });
  const client = createZuuClient({ baseUrl: "http://zuu.local", fetch: fetchFromApp, apiToken: currentApiToken });
  const health = await client.health();
  if (!health.ok) throw new Error("health check failed");
  if (health.status !== "ready" || health.protocolVersion !== "v1" || typeof health.uptimeMs !== "number" || !health.startedAt) {
    throw new Error("health response should include runtime status, protocol version, and uptime");
  }
  const publicHealth = await fetchFromApp("http://zuu.local/v1/health");
  if (publicHealth.status !== 200) throw new Error("health should be public");
  const legacyApi = await fetchFromApp("http://zuu.local/api/health");
  if (legacyApi.status !== 404) throw new Error("legacy /api routes should not be served");
  const legacyApiBody = await legacyApi.json() as { error?: { code?: string } };
  if (legacyApiBody.error?.code !== "not_found") throw new Error("legacy /api routes should return not_found");
  const unauthorized = await fetchFromApp("http://zuu.local/v1/diagnostics");
  if (unauthorized.status !== 401) throw new Error("missing api token should be rejected");
  const unauthorizedBody = await unauthorized.json() as { error?: { code?: string; status?: number } };
  if (unauthorizedBody.error?.code !== "unauthorized" || unauthorizedBody.error.status !== 401) {
    throw new Error("unauthorized response should include a stable error code");
  }
  const unauthenticatedClient = createZuuClient({ baseUrl: "http://zuu.local", fetch: fetchFromApp });
  await expectClientError(() => unauthenticatedClient.diagnostics(), { status: 401, code: "unauthorized" });
  const authStatus = await client.authStatus();
  if (!authStatus.auth.enabled || !authStatus.auth.tokenPreview) {
    throw new Error("auth status response is invalid");
  }
  if (!authStatus.auth.tokens.some((token) => token.scope === "admin") || !authStatus.auth.tokens.some((token) => token.scope === "read")) {
    throw new Error("auth status should expose admin and read token previews");
  }
  const readOnlyClient = createZuuClient({ baseUrl: "http://zuu.local", fetch: fetchFromApp, apiToken: auth.currentToken("read") });
  const readOnlyProjects = await readOnlyClient.listProjects();
  if (!Array.isArray(readOnlyProjects.projects)) {
    throw new Error("read token should be able to call protected GET routes");
  }
  await expectClientError(() => readOnlyClient.createProject({ cwd: process.cwd(), name: "read token write check" }), {
    status: 403,
    code: "forbidden",
  });
  const diagnostics = await client.diagnostics();
  if (!Array.isArray(diagnostics.resources.resourceDiagnostics)) {
    throw new Error("resource diagnostics response is invalid");
  }
  if (!Array.isArray(diagnostics.resources.blockedPackages)) {
    throw new Error("blocked packages response is invalid");
  }
  if (!Array.isArray(diagnostics.resources.stores)) {
    throw new Error("store diagnostics response is invalid");
  }
  if (!diagnostics.resources.stores.some((store) => store.name === "projects")) {
    throw new Error("project store diagnostics should be reported");
  }
  if (!diagnostics.resources.stores.some((store) => store.name === "auth-token")) {
    throw new Error("auth token store diagnostics should be reported");
  }
  if (!diagnostics.resources.stores.some((store) => store.name === "audit-events")) {
    throw new Error("audit event store diagnostics should be reported");
  }
  const auditEvents = await client.listAuditEvents(10);
  if (!Array.isArray(auditEvents.events)) {
    throw new Error("audit events response is invalid");
  }
  const healthAuditEvents = await client.listAuditEvents({ action: "api.read", target: "GET /v1/health", limit: 10 });
  if (healthAuditEvents.events.some((event) => event.target === "GET /v1/health")) {
    throw new Error("public health checks should not be recorded as read API audit events");
  }

  let sawAuthHeader = false;
  const authClient = createZuuClient({
    baseUrl: "http://zuu.local",
    apiToken: "check-token",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      sawAuthHeader = request.headers.get("authorization") === "Bearer check-token";
      return Response.json({ ok: true });
    },
  });
  await authClient.health();
  if (!sawAuthHeader) throw new Error("api token header was not sent");
  let sawRotateRoute = false;
  const rotateClient = createZuuClient({
    baseUrl: "http://zuu.local",
    apiToken: "check-token",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      sawRotateRoute = request.url === "http://zuu.local/v1/auth/rotate" && request.method === "POST";
      return Response.json({
        auth: {
          enabled: true,
          source: "local",
          canRotate: true,
          tokenPreview: "zuu_chec...oken",
        },
        apiToken: "zuu_check_new_token",
      });
    },
  });
  const rotateResponse = await rotateClient.rotateAuthToken();
  if (!sawRotateRoute || rotateResponse.apiToken !== "zuu_check_new_token") {
    throw new Error("rotate auth token client method should call the rotate route");
  }
  let sawAuditRoute = false;
  const auditClient = createZuuClient({
    baseUrl: "http://zuu.local",
    apiToken: "check-token",
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      sawAuditRoute =
        request.url === "http://zuu.local/v1/audit-events?limit=5&action=package.trust&outcome=success&target=npm%3Acheck";
      return Response.json({ events: [] });
    },
  });
  await auditClient.listAuditEvents({ limit: 5, action: "package.trust", outcome: "success", target: "npm:check" });
  if (!sawAuditRoute) throw new Error("audit event client method should call the audit route");

  const authServiceDir = mkdtempSync(join(tmpdir(), "zuu-auth-service-check-"));
  const localAuth = new AuthService(join(authServiceDir, "auth-token.json"), "");
  const originalLocalToken = localAuth.currentToken();
  const originalReadToken = localAuth.currentToken("read");
  const rotatedLocalAuth = localAuth.rotate();
  if (
    !originalLocalToken ||
    !originalReadToken ||
    rotatedLocalAuth.apiToken === originalLocalToken ||
    rotatedLocalAuth.readApiToken === originalReadToken ||
    localAuth.currentToken() !== rotatedLocalAuth.apiToken ||
    localAuth.currentToken("read") !== rotatedLocalAuth.readApiToken ||
    !localAuth.status().canRotate ||
    !localAuth.status().tokens.some((token) => token.scope === "read")
  ) {
    throw new Error("local auth tokens should be generated and rotated");
  }
  const envAuth = new AuthService(join(authServiceDir, "env-auth-token.json"), "env-token");
  if (envAuth.status().source !== "env" || envAuth.status().canRotate || envAuth.status().tokens[0]?.scope !== "admin") {
    throw new Error("env auth token status should be read-only");
  }

  const auditService = new AuditService(join(mkdtempSync(join(tmpdir(), "zuu-audit-service-check-")), "audit.json"));
  const auditEvent = auditService.record({ action: "package.trust", target: "npm:check", details: { source: "npm:check" } });
  auditService.record({ action: "package.add", target: "npm:other", outcome: "failure" });
  if (auditService.list(1).length !== 1 || auditService.list(0).length !== 1) {
    throw new Error("audit service should record and clamp event limits");
  }
  if (
    auditService.list({ action: "package.trust", outcome: "success", target: "check" }).length !== 1 ||
    auditService.list({ action: "package.trust", outcome: "failure" }).length !== 0
  ) {
    throw new Error("audit service should filter by action, outcome, and target");
  }
  try {
    envAuth.rotate();
    throw new Error("env auth token rotation should fail");
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) {
      throw new Error("env auth token rotation should fail with conflict");
    }
  }

  const malformedJson = await fetchFromApp("http://zuu.local/v1/packages", {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: "{",
  });
  if (malformedJson.status !== 400) throw new Error("malformed JSON should be rejected");
  const malformedJsonBody = await malformedJson.json() as { error?: { code?: string } };
  if (malformedJsonBody.error?.code !== "invalid_json") throw new Error("malformed JSON response should include invalid_json");
  const failedMutationAudit = await client.listAuditEvents({
    action: "api.mutate",
    outcome: "failure",
    target: "POST /v1/packages",
    limit: 10,
  });
  if (!failedMutationAudit.events.some((event) => event.target === "POST /v1/packages")) {
    throw new Error("failed mutating API calls should be recorded in audit events");
  }

  const { runs } = await client.listRuns();
  if (!Array.isArray(runs)) throw new Error("runs response is invalid");
  const projects = await client.listProjects();
  const readAuditEvents = await client.listAuditEvents({ action: "api.read", outcome: "success", target: "GET /v1/projects", limit: 20 });
  if (!readAuditEvents.events.some((event) => event.target === "GET /v1/projects")) {
    throw new Error("successful read API calls should be recorded in audit events");
  }
  const defaultProject = projects.projects.find((project) => project.id === "default");
  if (!defaultProject || defaultProject.cwd !== process.cwd()) {
    throw new Error("default project response is invalid");
  }
  const project = await client.createProject({ cwd: process.cwd(), name: "check project" });
  if (project.project.name !== "check project" || project.project.status !== "ready") {
    throw new Error("created project response is invalid");
  }
  const loadedProject = await client.getProject(project.project.id);
  if (loadedProject.project.id !== project.project.id) {
    throw new Error("project lookup returned the wrong project");
  }
  const renamedProject = await client.updateProject(project.project.id, { name: "renamed check project" });
  if (renamedProject.project.name !== "renamed check project") {
    throw new Error("project update response is invalid");
  }
  const projectSession = await client.createProjectSession(project.project.id, {
    persist: false,
    name: "project check",
  });
  if (projectSession.session.projectId !== project.project.id) {
    throw new Error("project session response should include projectId");
  }
  const projectSessions = await client.listProjectSessions(project.project.id);
  if (!projectSessions.sessions.some((session) => session.id === projectSession.session.id)) {
    throw new Error("project-scoped sessions should include the project session");
  }
  const loadedProjectSession = await client.getProjectSession(project.project.id, projectSession.session.id);
  if (loadedProjectSession.session.id !== projectSession.session.id) {
    throw new Error("project session lookup returned the wrong session");
  }
  const renamedProjectSession = await client.updateProjectSession(project.project.id, projectSession.session.id, {
    name: "renamed project session",
    tools: ["read", "zuu_status"],
  });
  if (
    renamedProjectSession.session.name !== "renamed project session" ||
    renamedProjectSession.session.activeTools.join(",") !== "read,zuu_status"
  ) {
    throw new Error("project session update response is invalid");
  }
  const globallyLoadedSession = await client.getSession(projectSession.session.id, project.project.id);
  if (globallyLoadedSession.session.name !== "renamed project session") {
    throw new Error("global session lookup returned the wrong session");
  }
  const globallyUpdatedSession = await client.updateSession(projectSession.session.id, { name: "global session rename" }, project.project.id);
  if (globallyUpdatedSession.session.name !== "global session rename") {
    throw new Error("global session update returned the wrong session");
  }
  const deletedProjectSession = await client.deleteProjectSession(project.project.id, projectSession.session.id);
  if (deletedProjectSession.session.id !== projectSession.session.id) {
    throw new Error("project session delete returned the wrong session");
  }
  const projectSessionsAfterDelete = await client.listProjectSessions(project.project.id);
  if (projectSessionsAfterDelete.sessions.some((session) => session.id === projectSession.session.id)) {
    throw new Error("deleted project session should be removed from active sessions");
  }
  const globalProjectSessions = await client.listSessions(project.project.id);
  if (!globalProjectSessions.sessions.every((session) => session.projectId === project.project.id)) {
    throw new Error("global session list should support project filtering");
  }
  const projectStoredSessions = await client.listProjectStoredSessions(project.project.id);
  if (!Array.isArray(projectStoredSessions.sessions)) {
    throw new Error("project stored sessions response is invalid");
  }
  if (projectStoredSessions.sessions.some((session) => session.projectId !== project.project.id)) {
    throw new Error("project stored sessions should include the filtered projectId");
  }
  const projectRuns = await client.listProjectRuns(project.project.id);
  if (!Array.isArray(projectRuns.runs)) {
    throw new Error("project-scoped runs response is invalid");
  }
  const deletedProject = await client.deleteProject(project.project.id);
  if (deletedProject.project.id !== project.project.id) {
    throw new Error("project delete returned the wrong project");
  }
  await expectClientError(() => client.getProject(project.project.id), { status: 404, code: "not_found" });
  await expectClientError(() => client.deleteProject("default"), { status: 400, code: "validation_failed" });
  await expectClientError(() => client.createProject({ cwd: ".." }), { status: 400, code: "validation_failed" });
  await expectClientError(() => client.getSession("missing"), { status: 404, code: "not_found" });
  await expectClientError(() => client.updateSession("missing", { name: "missing" }), { status: 404, code: "not_found" });
  await expectClientError(() => client.deleteSession("missing"), { status: 404, code: "not_found" });
  await expectClientError(() => client.getProjectSession(defaultProject.id, "missing"), { status: 404, code: "not_found" });
  await expectClientError(() => client.listRunEvents("missing"), { status: 404, code: "not_found" });
  await expectClientError(() => client.abortRun("missing"), { status: 404, code: "not_found" });
  await expectClientError(() => client.listProjectRunEvents(defaultProject.id, "missing"), { status: 404, code: "not_found" });
  await expectClientError(() => client.abortProjectRun(defaultProject.id, "missing"), { status: 404, code: "not_found" });
  const missingEventStream = await fetchFromApp("http://zuu.local/v1/events?runId=missing", {
    headers: authHeaders(),
  });
  if (missingEventStream.status !== 404) throw new Error("missing event stream run should fail before streaming");

  let eventStreamRequestCount = 0;
  const eventStreamLastEventIds: Array<string | null> = [];
  const eventStreamClient = createZuuClient({
    baseUrl: "http://zuu.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      eventStreamRequestCount += 1;
      eventStreamLastEventIds.push(request.headers.get("last-event-id"));
      const body =
        eventStreamRequestCount === 1
          ? [
              "id: event-check:1",
              "event: text_delta",
              "data: {\"id\":\"event-check:1\",\"createdAt\":\"2026-08-12T00:00:00.000Z\",\"runId\":\"event-check\",\"type\":\"text_delta\",\"delta\":\"hello\"}",
              "",
              "event: heartbeat",
              "data: {}",
              "",
            ].join("\n")
          : [
              "id: event-check:1",
              "event: text_delta",
              "data: {\"id\":\"event-check:1\",\"createdAt\":\"2026-08-12T00:00:00.000Z\",\"runId\":\"event-check\",\"type\":\"text_delta\",\"delta\":\"hello again\"}",
              "",
              "id: event-check:2",
              "event: done",
              "data: {\"id\":\"event-check:2\",\"createdAt\":\"2026-08-12T00:00:01.000Z\",\"runId\":\"event-check\",\"type\":\"done\"}",
              "",
            ].join("\n");
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body));
          controller.close();
        },
      }), {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  const streamedEvents = [];
  let eventStreamOpenCount = 0;
  let eventStreamReconnectCount = 0;
  for await (const event of eventStreamClient.subscribeEvents({
    afterEventId: "event-check:0",
    reconnectDelayMs: 0,
    onOpen: () => {
      eventStreamOpenCount += 1;
    },
    onReconnect: () => {
      eventStreamReconnectCount += 1;
    },
  })) {
    streamedEvents.push(event);
    if (streamedEvents.length === 2) break;
  }
  if (
    eventStreamRequestCount !== 2 ||
    eventStreamLastEventIds[0] !== "event-check:0" ||
    eventStreamLastEventIds[1] !== "event-check:1" ||
    eventStreamOpenCount !== 2 ||
    eventStreamReconnectCount !== 1 ||
    streamedEvents.map((event) => event.id).join(",") !== "event-check:1,event-check:2"
  ) {
    throw new Error("event stream client should report open/reconnect, reconnect with Last-Event-ID, dedupe events, and ignore heartbeats");
  }

  const workflows = await client.listProjectWorkflows(defaultProject.id);
  if (!Array.isArray(workflows.workflows) || workflows.workflows.length === 0) {
    throw new Error("workflows response is invalid");
  }
  if (workflows.backend.kind !== "fake" || workflows.backend.status !== "ready") {
    throw new Error("workflow backend info is invalid");
  }
  const workflowRun = await client.startProjectWorkflow(defaultProject.id, workflows.workflows[0].id, {
    prompt: "contract check",
    inputs: { source: "scripts/check.ts" },
  });
  if (workflowRun.run.projectId !== defaultProject.id) {
    throw new Error("workflow run should include projectId");
  }
  if (workflowRun.run.status !== "completed" || !workflowRun.run.finishedAt || workflowRun.run.stages.length === 0 || workflowRun.run.tasks.length === 0) {
    throw new Error("workflow run response is invalid");
  }
  const workflowRuns = await client.listWorkflowRuns();
  if (!workflowRuns.runs.some((run) => run.id === workflowRun.run.id)) {
    throw new Error("workflow run was not listed");
  }
  const filteredWorkflowRuns = await client.listProjectWorkflowRuns(defaultProject.id);
  if (!filteredWorkflowRuns.runs.every((run) => run.projectId === defaultProject.id)) {
    throw new Error("project workflow runs should stay inside the project");
  }
  if (!filteredWorkflowRuns.runs.some((run) => run.id === workflowRun.run.id)) {
    throw new Error("project-filtered workflow runs should include the default project run");
  }
  const loadedWorkflowRun = await client.getProjectWorkflowRun(defaultProject.id, workflowRun.run.id);
  if (loadedWorkflowRun.run.id !== workflowRun.run.id) {
    throw new Error("workflow run lookup returned the wrong run");
  }
  const workflowStages = await client.listProjectWorkflowStages(defaultProject.id, workflowRun.run.id);
  if (workflowStages.stages.length !== workflowRun.run.stages.length || workflowStages.stages[0]?.runId !== workflowRun.run.id) {
    throw new Error("workflow stage list returned the wrong stages");
  }
  const workflowTasks = await client.listProjectWorkflowTasks(defaultProject.id, workflowRun.run.id);
  if (workflowTasks.tasks.length !== workflowRun.run.tasks.length || workflowTasks.tasks[0]?.runId !== workflowRun.run.id) {
    throw new Error("workflow task list returned the wrong tasks");
  }
  const workflowArtifact = workflowRun.run.artifacts[0];
  if (!workflowArtifact) throw new Error("workflow run should include an artifact");
  const loadedWorkflowArtifact = await client.getProjectWorkflowArtifact(defaultProject.id, workflowArtifact.id);
  if (loadedWorkflowArtifact.artifact.id !== workflowArtifact.id || loadedWorkflowArtifact.artifact.runId !== workflowRun.run.id) {
    throw new Error("workflow artifact lookup returned the wrong artifact");
  }
  const globalWorkflowStages = await client.listWorkflowStages(workflowRun.run.id);
  if (globalWorkflowStages.stages[0]?.id !== workflowStages.stages[0]?.id) {
    throw new Error("global workflow stage list returned the wrong stages");
  }
  const globalWorkflowTasks = await client.listWorkflowTasks(workflowRun.run.id);
  if (globalWorkflowTasks.tasks[0]?.id !== workflowTasks.tasks[0]?.id) {
    throw new Error("global workflow task list returned the wrong tasks");
  }
  const globalWorkflowArtifact = await client.getWorkflowArtifact(workflowArtifact.id);
  if (globalWorkflowArtifact.artifact.id !== workflowArtifact.id) {
    throw new Error("global workflow artifact lookup returned the wrong artifact");
  }
  const abortedWorkflowRun = await client.abortProjectWorkflowRun(defaultProject.id, workflowRun.run.id);
  if (abortedWorkflowRun.run.id !== workflowRun.run.id) {
    throw new Error("workflow run abort returned the wrong run");
  }
  await expectClientError(() => client.getWorkflowRun("missing"), { status: 404, code: "not_found" });
  await expectClientError(() => client.getProjectWorkflowRun(defaultProject.id, "missing"), { status: 404, code: "not_found" });
  await expectClientError(() => client.listWorkflowStages("missing"), { status: 404, code: "not_found" });
  await expectClientError(() => client.listProjectWorkflowTasks(defaultProject.id, "missing"), { status: 404, code: "not_found" });
  await expectClientError(() => client.getWorkflowArtifact("missing"), { status: 404, code: "not_found" });
  await expectClientError(() => client.getProjectWorkflowArtifact(defaultProject.id, "missing"), { status: 404, code: "not_found" });
  let missingWorkflowFailed = false;
  try {
    await client.startProjectWorkflow(defaultProject.id, "missing");
  } catch {
    missingWorkflowFailed = true;
  }
  if (!missingWorkflowFailed) throw new Error("missing workflow should fail");

  const piBackend = createWorkflowBackend({
    path: join(mkdtempSync(join(tmpdir(), "zuu-pi-workflow-check-")), "workflow-runs.json"),
    agentDir: mkdtempSync(join(tmpdir(), "zuu-pi-agent-check-")),
    packages: ["npm:@agwab/pi-workflow"],
    requestedKind: "pi-package",
    launchPrompt: async () => {
      throw new Error("pi-package launch should not be reached when backend is unavailable");
    },
  });
  const piBackendInfo = piBackend.getInfo();
  if (piBackendInfo.kind !== "pi-package" || piBackendInfo.status !== "unavailable") {
    throw new Error("pi-package backend should be unavailable in the check environment");
  }
  let unavailablePiWorkflowFailed = false;
  try {
    await piBackend.start("deep-research", { prompt: "contract check" });
  } catch {
    unavailablePiWorkflowFailed = true;
  }
  if (!unavailablePiWorkflowFailed) throw new Error("unavailable pi-package workflow should fail");

  const schedulesBefore = await client.listProjectSchedules(defaultProject.id);
  if (!Array.isArray(schedulesBefore.schedules)) throw new Error("schedules response is invalid");
  const schedule = await client.createProjectSchedule(defaultProject.id, {
    name: "check workflow schedule",
    trigger: { kind: "interval", everyMs: 60_000 },
    action: {
      type: "workflow",
      workflowId: workflows.workflows[0].id,
      prompt: "scheduled contract check",
      inputs: { source: "scripts/check.ts" },
    },
  });
  if (schedule.schedule.action.projectId !== defaultProject.id) {
    throw new Error("schedule action should default to the default project");
  }
  if (schedule.schedule.overlapPolicy !== "skip") {
    throw new Error("schedule overlap policy should default to skip");
  }
  if (schedule.schedule.misfirePolicy !== "skip") {
    throw new Error("schedule misfire policy should default to skip");
  }
  const updatedSchedule = await client.updateProjectSchedule(defaultProject.id, schedule.schedule.id, {
    name: "updated workflow schedule",
    trigger: { kind: "interval", everyMs: 120_000 },
    misfirePolicy: "run_once",
    retryPolicy: { maxAttempts: 2, backoffMs: 0 },
  });
  if (
    updatedSchedule.schedule.id !== schedule.schedule.id ||
    updatedSchedule.schedule.name !== "updated workflow schedule" ||
    updatedSchedule.schedule.trigger.everyMs !== 120_000 ||
    updatedSchedule.schedule.misfirePolicy !== "run_once" ||
    updatedSchedule.schedule.retryPolicy?.maxAttempts !== 2 ||
    !updatedSchedule.schedule.nextRunAt
  ) {
    throw new Error("schedule update response is invalid");
  }
  const retryPolicyRemovedSchedule = await client.updateProjectSchedule(defaultProject.id, schedule.schedule.id, {
    retryPolicy: null,
  });
  if (retryPolicyRemovedSchedule.schedule.retryPolicy) {
    throw new Error("schedule retry policy should be removable");
  }
  const filteredSchedules = await client.listProjectSchedules(defaultProject.id);
  if (!filteredSchedules.schedules.some((item) => item.id === schedule.schedule.id)) {
    throw new Error("project-filtered schedules should include the default project schedule");
  }
  if (!filteredSchedules.schedules.every((item) => item.action.projectId === defaultProject.id)) {
    throw new Error("schedules should support project filtering");
  }
  if (schedule.schedule.status !== "active" || !schedule.schedule.nextRunAt) {
    throw new Error("created schedule response is invalid");
  }
  const pausedSchedule = await client.pauseProjectSchedule(defaultProject.id, schedule.schedule.id);
  if (pausedSchedule.schedule.status !== "paused" || pausedSchedule.schedule.nextRunAt) {
    throw new Error("pause schedule response is invalid");
  }
  const resumedSchedule = await client.resumeProjectSchedule(defaultProject.id, schedule.schedule.id);
  if (resumedSchedule.schedule.status !== "active" || !resumedSchedule.schedule.nextRunAt) {
    throw new Error("resume schedule response is invalid");
  }
  const nextRunAtBeforeTrigger = resumedSchedule.schedule.nextRunAt;
  const triggeredSchedule = await client.triggerProjectSchedule(defaultProject.id, schedule.schedule.id);
  const scheduleRun = triggeredSchedule.schedule.runs[0];
  if (scheduleRun?.status !== "completed" || !scheduleRun.workflowRunId || !scheduleRun.scheduledFor || !scheduleRun.finishedAt) {
    throw new Error("triggered schedule response is invalid");
  }
  const scheduleRuns = await client.listProjectScheduleRuns(defaultProject.id, schedule.schedule.id);
  if (!scheduleRuns.runs.some((run) => run.id === scheduleRun.id)) {
    throw new Error("schedule run list should include the triggered run");
  }
  const loadedScheduleRun = await client.getProjectScheduleRun(defaultProject.id, scheduleRun.id);
  if (loadedScheduleRun.run.id !== scheduleRun.id || loadedScheduleRun.run.scheduleId !== schedule.schedule.id) {
    throw new Error("schedule run lookup returned the wrong run");
  }
  const unchangedCompletedScheduleRun = await client.abortProjectScheduleRun(defaultProject.id, scheduleRun.id);
  if (unchangedCompletedScheduleRun.run.status !== "completed") {
    throw new Error("aborting a completed schedule run should leave it completed");
  }
  if (triggeredSchedule.schedule.nextRunAt !== nextRunAtBeforeTrigger) {
    throw new Error("manual schedule trigger should preserve the next automatic run");
  }
  const loadedSchedule = await client.getProjectSchedule(defaultProject.id, schedule.schedule.id);
  if (loadedSchedule.schedule.id !== schedule.schedule.id) {
    throw new Error("schedule lookup returned the wrong schedule");
  }
  let unsupportedUpdateMisfireFailed = false;
  try {
    await client.updateProjectSchedule(defaultProject.id, schedule.schedule.id, {
      misfirePolicy: "later" as never,
    });
  } catch {
    unsupportedUpdateMisfireFailed = true;
  }
  if (!unsupportedUpdateMisfireFailed) throw new Error("unsupported update misfire policy should fail");
  const deletedSchedule = await client.deleteProjectSchedule(defaultProject.id, schedule.schedule.id);
  if (deletedSchedule.schedule.id !== schedule.schedule.id) {
    throw new Error("delete schedule returned the wrong schedule");
  }
  const cronSchedule = await client.createProjectSchedule(defaultProject.id, {
    trigger: { kind: "cron", cron: "*/5 * * * *" },
    action: { type: "workflow", workflowId: workflows.workflows[0].id },
  });
  if (cronSchedule.schedule.trigger.kind !== "cron" || !cronSchedule.schedule.nextRunAt) {
    throw new Error("cron schedule response is invalid");
  }
  await client.deleteProjectSchedule(defaultProject.id, cronSchedule.schedule.id);
  const queuedPolicySchedule = await client.createProjectSchedule(defaultProject.id, {
    trigger: { kind: "interval", everyMs: 60_000 },
    action: { type: "workflow", workflowId: workflows.workflows[0].id },
    overlapPolicy: "queue",
  });
  if (queuedPolicySchedule.schedule.overlapPolicy !== "queue") {
    throw new Error("queue overlap policy should be accepted");
  }
  await client.deleteProjectSchedule(defaultProject.id, queuedPolicySchedule.schedule.id);
  const parallelPolicySchedule = await client.createProjectSchedule(defaultProject.id, {
    trigger: { kind: "interval", everyMs: 60_000 },
    action: { type: "workflow", workflowId: workflows.workflows[0].id },
    overlapPolicy: "parallel",
  });
  if (parallelPolicySchedule.schedule.overlapPolicy !== "parallel") {
    throw new Error("parallel overlap policy should be accepted");
  }
  await client.deleteProjectSchedule(defaultProject.id, parallelPolicySchedule.schedule.id);
  let unsupportedMisfireFailed = false;
  try {
    await client.createProjectSchedule(defaultProject.id, {
      trigger: { kind: "interval", everyMs: 60_000 },
      action: { type: "workflow", workflowId: workflows.workflows[0].id },
      misfirePolicy: "later" as never,
    });
  } catch {
    unsupportedMisfireFailed = true;
  }
  if (!unsupportedMisfireFailed) throw new Error("unsupported misfire policy should fail");
  let unsupportedRetryPolicyFailed = false;
  try {
    await client.createProjectSchedule(defaultProject.id, {
      trigger: { kind: "interval", everyMs: 60_000 },
      action: { type: "workflow", workflowId: workflows.workflows[0].id },
      retryPolicy: { maxAttempts: 0, backoffMs: 0 },
    });
  } catch {
    unsupportedRetryPolicyFailed = true;
  }
  if (!unsupportedRetryPolicyFailed) throw new Error("unsupported retry policy should fail");
  const shanghaiCronSchedule = await client.createProjectSchedule(defaultProject.id, {
    trigger: { kind: "cron", cron: "0 9 * * *", timezone: "Asia/Shanghai" },
    action: { type: "workflow", workflowId: workflows.workflows[0].id },
  });
  const shanghaiCronNext = shanghaiCronSchedule.schedule.nextRunAt
    ? Object.fromEntries(new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Shanghai",
        hourCycle: "h23",
        hour: "2-digit",
        minute: "2-digit",
      }).formatToParts(new Date(shanghaiCronSchedule.schedule.nextRunAt)).map((part) => [part.type, part.value]))
    : undefined;
  if (
    shanghaiCronSchedule.schedule.trigger.timezone !== "Asia/Shanghai" ||
    shanghaiCronNext?.hour !== "09" ||
    shanghaiCronNext?.minute !== "00"
  ) {
    throw new Error("cron timezone schedule should compute nextRunAt in the requested timezone");
  }
  await client.deleteProjectSchedule(defaultProject.id, shanghaiCronSchedule.schedule.id);
  let invalidCronTimezoneFailed = false;
  try {
    await client.createProjectSchedule(defaultProject.id, {
      trigger: { kind: "cron", cron: "* * * * *", timezone: "Not/AZone" },
      action: { type: "workflow", workflowId: workflows.workflows[0].id },
    });
  } catch {
    invalidCronTimezoneFailed = true;
  }
  if (!invalidCronTimezoneFailed) throw new Error("invalid cron timezone should fail");

  let releaseOverlapRun: (() => void) | undefined;
  let markOverlapStarted: (() => void) | undefined;
  const overlapStarted = new Promise<void>((resolve) => {
    markOverlapStarted = resolve;
  });
  const overlapStore = new ScheduleStore(
    join(mkdtempSync(join(tmpdir(), "zuu-schedule-overlap-check-")), "schedules.json"),
    {
      runPrompt: async () => {
        throw new Error("overlap check should use workflow action");
      },
      runWorkflow: async () => {
        markOverlapStarted?.();
        await new Promise<void>((resolve) => {
          releaseOverlapRun = resolve;
        });
        return { workflowRunId: "overlap-workflow-run" };
      },
    },
  );
  const overlapSchedule = overlapStore.create({
    trigger: { kind: "interval", everyMs: 60_000 },
    action: { type: "workflow", workflowId: workflows.workflows[0].id, projectId: defaultProject.id },
  });
  const firstOverlapTrigger = overlapStore.trigger(overlapSchedule.id);
  await overlapStarted;
  const skippedOverlapSchedule = await overlapStore.trigger(overlapSchedule.id);
  const skippedOverlapRun = skippedOverlapSchedule.runs[0];
  if (
    skippedOverlapRun?.status !== "skipped" ||
    skippedOverlapRun.reason !== "schedule_overlap" ||
    !skippedOverlapRun.finishedAt ||
    skippedOverlapSchedule.runs[1]?.status !== "running"
  ) {
    throw new Error("overlapping schedule trigger should be recorded as skipped");
  }
  releaseOverlapRun?.();
  await firstOverlapTrigger;
  const completedOverlapRun = overlapStore.getRun(skippedOverlapSchedule.runs[1].id);
  if (completedOverlapRun.status !== "completed" || completedOverlapRun.workflowRunId !== "overlap-workflow-run") {
    throw new Error("first overlapping schedule run should complete after the skipped run is recorded");
  }
  overlapStore.dispose();

  let releaseQueuedFirstRun: (() => void) | undefined;
  let markQueuedFirstStarted: (() => void) | undefined;
  let markQueuedSecondStarted: (() => void) | undefined;
  let queuedRunCount = 0;
  const queuedFirstStarted = new Promise<void>((resolve) => {
    markQueuedFirstStarted = resolve;
  });
  const queuedSecondStarted = new Promise<void>((resolve) => {
    markQueuedSecondStarted = resolve;
  });
  const queueOverlapStore = new ScheduleStore(
    join(mkdtempSync(join(tmpdir(), "zuu-schedule-queue-overlap-check-")), "schedules.json"),
    {
      runPrompt: async () => {
        throw new Error("queue overlap check should use workflow action");
      },
      runWorkflow: async () => {
        queuedRunCount += 1;
        if (queuedRunCount === 1) {
          markQueuedFirstStarted?.();
          await new Promise<void>((resolve) => {
            releaseQueuedFirstRun = resolve;
          });
        } else {
          markQueuedSecondStarted?.();
        }
        return { workflowRunId: `queue-overlap-workflow-${queuedRunCount}` };
      },
    },
  );
  const queueOverlapSchedule = queueOverlapStore.create({
    trigger: { kind: "interval", everyMs: 60_000 },
    action: { type: "workflow", workflowId: workflows.workflows[0].id, projectId: defaultProject.id },
    overlapPolicy: "queue",
  });
  const firstQueuedTrigger = queueOverlapStore.trigger(queueOverlapSchedule.id);
  await queuedFirstStarted;
  const queuedSchedule = await queueOverlapStore.trigger(queueOverlapSchedule.id);
  const queuedOverlapRun = queuedSchedule.runs[0];
  if (
    queuedOverlapRun?.status !== "queued" ||
    queuedOverlapRun.reason !== "schedule_overlap" ||
    queuedSchedule.runs[1]?.status !== "running"
  ) {
    throw new Error("queue overlap policy should record a queued run while a run is active");
  }
  releaseQueuedFirstRun?.();
  await firstQueuedTrigger;
  await queuedSecondStarted;
  await new Promise((resolve) => setTimeout(resolve, 0));
  const completedQueuedRun = queueOverlapStore.getRun(queuedOverlapRun.id);
  if (completedQueuedRun.status !== "completed" || completedQueuedRun.workflowRunId !== "queue-overlap-workflow-2") {
    throw new Error("queued schedule run should execute after the active run finishes");
  }
  queueOverlapStore.dispose();

  let releaseAbortQueuedFirstRun: (() => void) | undefined;
  let markAbortQueuedFirstStarted: (() => void) | undefined;
  let abortQueuedRunCount = 0;
  const abortQueuedFirstStarted = new Promise<void>((resolve) => {
    markAbortQueuedFirstStarted = resolve;
  });
  const abortQueuedStore = new ScheduleStore(
    join(mkdtempSync(join(tmpdir(), "zuu-schedule-abort-queued-check-")), "schedules.json"),
    {
      runPrompt: async () => {
        throw new Error("abort queued check should use workflow action");
      },
      runWorkflow: async () => {
        abortQueuedRunCount += 1;
        markAbortQueuedFirstStarted?.();
        await new Promise<void>((resolve) => {
          releaseAbortQueuedFirstRun = resolve;
        });
        return { workflowRunId: `abort-queued-workflow-${abortQueuedRunCount}` };
      },
    },
  );
  const abortQueuedSchedule = abortQueuedStore.create({
    trigger: { kind: "interval", everyMs: 60_000 },
    action: { type: "workflow", workflowId: workflows.workflows[0].id, projectId: defaultProject.id },
    overlapPolicy: "queue",
  });
  const abortQueuedFirstTrigger = abortQueuedStore.trigger(abortQueuedSchedule.id);
  await abortQueuedFirstStarted;
  const abortQueuedScheduleWithRun = await abortQueuedStore.trigger(abortQueuedSchedule.id);
  const abortedQueuedRun = abortQueuedStore.abortRun(abortQueuedScheduleWithRun.runs[0].id);
  if (abortedQueuedRun.status !== "aborted" || abortedQueuedRun.reason !== "schedule_run_aborted" || !abortedQueuedRun.finishedAt) {
    throw new Error("queued schedule run abort should mark the run aborted");
  }
  releaseAbortQueuedFirstRun?.();
  await abortQueuedFirstTrigger;
  if (abortQueuedRunCount !== 1 || abortQueuedStore.getRun(abortedQueuedRun.id).status !== "aborted") {
    throw new Error("aborted queued schedule run should not execute later");
  }
  abortQueuedStore.dispose();

  let releaseAbortRunningRun: (() => void) | undefined;
  let markAbortRunningStarted: (() => void) | undefined;
  const abortRunningStarted = new Promise<void>((resolve) => {
    markAbortRunningStarted = resolve;
  });
  const abortRunningStore = new ScheduleStore(
    join(mkdtempSync(join(tmpdir(), "zuu-schedule-abort-running-check-")), "schedules.json"),
    {
      runPrompt: async () => {
        throw new Error("abort running check should use workflow action");
      },
      runWorkflow: async () => {
        markAbortRunningStarted?.();
        await new Promise<void>((resolve) => {
          releaseAbortRunningRun = resolve;
        });
        return { workflowRunId: "abort-running-workflow" };
      },
    },
  );
  const abortRunningSchedule = abortRunningStore.create({
    trigger: { kind: "interval", everyMs: 60_000 },
    action: { type: "workflow", workflowId: workflows.workflows[0].id, projectId: defaultProject.id },
  });
  const abortRunningTrigger = abortRunningStore.trigger(abortRunningSchedule.id);
  await abortRunningStarted;
  const runningRun = abortRunningStore.get(abortRunningSchedule.id).runs[0];
  const abortedRunningRun = abortRunningStore.abortRun(runningRun.id);
  if (abortedRunningRun.status !== "aborted" || abortedRunningRun.reason !== "schedule_run_aborted") {
    throw new Error("running schedule run abort should mark the run aborted");
  }
  releaseAbortRunningRun?.();
  await abortRunningTrigger;
  const completedAfterAbortRun = abortRunningStore.getRun(runningRun.id);
  if (completedAfterAbortRun.status !== "aborted" || completedAfterAbortRun.workflowRunId !== "abort-running-workflow") {
    throw new Error("aborted running schedule run should stay aborted after the executor settles");
  }
  abortRunningStore.dispose();

  let parallelRunCount = 0;
  const releaseParallelRuns: Array<() => void> = [];
  let markParallelFirstStarted: (() => void) | undefined;
  let markParallelBothStarted: (() => void) | undefined;
  const parallelFirstStarted = new Promise<void>((resolve) => {
    markParallelFirstStarted = resolve;
  });
  const parallelBothStarted = new Promise<void>((resolve) => {
    markParallelBothStarted = resolve;
  });
  const parallelOverlapStore = new ScheduleStore(
    join(mkdtempSync(join(tmpdir(), "zuu-schedule-parallel-overlap-check-")), "schedules.json"),
    {
      runPrompt: async () => {
        throw new Error("parallel overlap check should use workflow action");
      },
      runWorkflow: async () => {
        parallelRunCount += 1;
        if (parallelRunCount === 1) markParallelFirstStarted?.();
        if (parallelRunCount === 2) markParallelBothStarted?.();
        const runNumber = parallelRunCount;
        await new Promise<void>((resolve) => {
          releaseParallelRuns.push(resolve);
        });
        return { workflowRunId: `parallel-overlap-workflow-${runNumber}` };
      },
    },
  );
  const parallelOverlapSchedule = parallelOverlapStore.create({
    trigger: { kind: "interval", everyMs: 60_000 },
    action: { type: "workflow", workflowId: workflows.workflows[0].id, projectId: defaultProject.id },
    overlapPolicy: "parallel",
  });
  const firstParallelTrigger = parallelOverlapStore.trigger(parallelOverlapSchedule.id);
  await parallelFirstStarted;
  const secondParallelTrigger = parallelOverlapStore.trigger(parallelOverlapSchedule.id);
  await parallelBothStarted;
  if (parallelOverlapStore.get(parallelOverlapSchedule.id).runs.filter((run) => run.status === "running").length !== 2) {
    throw new Error("parallel overlap policy should allow concurrent schedule runs");
  }
  releaseParallelRuns.forEach((release) => release());
  await Promise.all([firstParallelTrigger, secondParallelTrigger]);
  const completedParallelRuns = parallelOverlapStore.get(parallelOverlapSchedule.id).runs.filter((run) => run.status === "completed");
  if (completedParallelRuns.length !== 2 || completedParallelRuns.some((run) => !run.workflowRunId)) {
    throw new Error("parallel schedule runs should both complete");
  }
  parallelOverlapStore.dispose();

  let retryAttemptCount = 0;
  const retryStore = new ScheduleStore(join(mkdtempSync(join(tmpdir(), "zuu-schedule-retry-check-")), "schedules.json"), {
    runPrompt: async () => {
      throw new Error("retry check should use workflow action");
    },
    runWorkflow: async () => {
      retryAttemptCount += 1;
      if (retryAttemptCount === 1) throw new Error("transient schedule failure");
      return { workflowRunId: "retry-workflow-run" };
    },
  });
  const retrySchedule = retryStore.create({
    trigger: { kind: "interval", everyMs: 60_000 },
    action: { type: "workflow", workflowId: workflows.workflows[0].id, projectId: defaultProject.id },
    retryPolicy: { maxAttempts: 2, backoffMs: 0 },
  });
  const completedRetrySchedule = await retryStore.trigger(retrySchedule.id);
  const completedRetryRun = completedRetrySchedule.runs[0];
  if (
    completedRetryRun?.status !== "completed" ||
    completedRetryRun.attempts !== 2 ||
    completedRetryRun.workflowRunId !== "retry-workflow-run" ||
    completedRetryRun.error
  ) {
    throw new Error("schedule retry policy should retry transient failures and clear the final error");
  }
  retryStore.dispose();

  let codedRetryAttemptCount = 0;
  const codedRetryStore = new ScheduleStore(join(mkdtempSync(join(tmpdir(), "zuu-schedule-coded-retry-check-")), "schedules.json"), {
    runPrompt: async () => {
      throw new Error("coded retry check should use workflow action");
    },
    runWorkflow: async () => {
      codedRetryAttemptCount += 1;
      const error = new Error("fatal schedule failure") as Error & { code: string };
      error.code = "fatal";
      throw error;
    },
  });
  const codedRetrySchedule = codedRetryStore.create({
    trigger: { kind: "interval", everyMs: 60_000 },
    action: { type: "workflow", workflowId: workflows.workflows[0].id, projectId: defaultProject.id },
    retryPolicy: { maxAttempts: 3, backoffMs: 0, retryableCodes: ["transient"] },
  });
  const failedCodedRetrySchedule = await codedRetryStore.trigger(codedRetrySchedule.id);
  const failedCodedRetryRun = failedCodedRetrySchedule.runs[0];
  if (failedCodedRetryRun?.status !== "failed" || failedCodedRetryRun.attempts !== 1 || codedRetryAttemptCount !== 1) {
    throw new Error("schedule retry policy should respect retryable error codes");
  }
  codedRetryStore.dispose();

  const missedRunAt = new Date(Date.now() - 60_000).toISOString();
  const misfireSkipPath = join(mkdtempSync(join(tmpdir(), "zuu-schedule-misfire-skip-check-")), "schedules.json");
  writeFileSync(
    misfireSkipPath,
    JSON.stringify({
      version: 1,
      data: [
        {
          id: "misfire-skip",
          name: "misfire skip",
          status: "active",
          trigger: { kind: "once", runAt: missedRunAt },
          action: { type: "workflow", workflowId: workflows.workflows[0].id, projectId: defaultProject.id },
          overlapPolicy: "skip",
          misfirePolicy: "skip",
          createdAt: missedRunAt,
          updatedAt: missedRunAt,
          nextRunAt: missedRunAt,
          runs: [],
        },
      ],
    }),
    "utf8",
  );
  const misfireSkipStore = new ScheduleStore(misfireSkipPath, {
    runPrompt: async () => {
      throw new Error("misfire skip check should use workflow action");
    },
    runWorkflow: async () => {
      throw new Error("misfire skip policy should not run missed work");
    },
  });
  const misfireSkipSchedule = misfireSkipStore.get("misfire-skip");
  if (
    misfireSkipSchedule.status !== "paused" ||
    misfireSkipSchedule.nextRunAt ||
    misfireSkipSchedule.runs[0]?.status !== "skipped" ||
    misfireSkipSchedule.runs[0].reason !== "schedule_misfire" ||
    misfireSkipSchedule.runs[0].scheduledFor !== missedRunAt
  ) {
    throw new Error("misfire skip policy should record a skipped run and pause a missed one-shot schedule");
  }
  misfireSkipStore.dispose();

  const misfireRunOncePath = join(mkdtempSync(join(tmpdir(), "zuu-schedule-misfire-run-once-check-")), "schedules.json");
  writeFileSync(
    misfireRunOncePath,
    JSON.stringify({
      version: 1,
      data: [
        {
          id: "misfire-run-once",
          name: "misfire run once",
          status: "active",
          trigger: { kind: "interval", everyMs: 60_000 },
          action: { type: "workflow", workflowId: workflows.workflows[0].id, projectId: defaultProject.id },
          overlapPolicy: "skip",
          misfirePolicy: "run_once",
          createdAt: missedRunAt,
          updatedAt: missedRunAt,
          nextRunAt: missedRunAt,
          runs: [],
        },
      ],
    }),
    "utf8",
  );
  let markMisfireRunOnceTriggered: (() => void) | undefined;
  const misfireRunOnceTriggered = new Promise<void>((resolve) => {
    markMisfireRunOnceTriggered = resolve;
  });
  const misfireRunOnceStore = new ScheduleStore(misfireRunOncePath, {
    runPrompt: async () => {
      throw new Error("misfire run_once check should use workflow action");
    },
    runWorkflow: async () => {
      markMisfireRunOnceTriggered?.();
      return { workflowRunId: "misfire-run-once-workflow" };
    },
  });
  let misfireRunOnceTimeoutId: NodeJS.Timeout | undefined;
  const misfireRunOnceTimeout = new Promise<never>((_, reject) => {
    misfireRunOnceTimeoutId = setTimeout(() => reject(new Error("misfire run_once policy did not trigger missed work")), 1_000);
  });
  await Promise.race([misfireRunOnceTriggered, misfireRunOnceTimeout]);
  if (misfireRunOnceTimeoutId) clearTimeout(misfireRunOnceTimeoutId);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const misfireRunOnceSchedule = misfireRunOnceStore.get("misfire-run-once");
  if (
    misfireRunOnceSchedule.runs[0]?.status !== "completed" ||
    misfireRunOnceSchedule.runs[0].workflowRunId !== "misfire-run-once-workflow" ||
    misfireRunOnceSchedule.runs[0].scheduledFor !== missedRunAt ||
    !misfireRunOnceSchedule.nextRunAt
  ) {
    throw new Error("misfire run_once policy should run the missed work once and keep interval schedules active");
  }
  misfireRunOnceStore.dispose();

  const approvals = await client.listApprovals();
  if (!Array.isArray(approvals.approvals)) throw new Error("approvals response is invalid");

  let invalidApprovalStatusFailed = false;
  try {
    await client.listApprovals("unknown" as never);
  } catch {
    invalidApprovalStatusFailed = true;
  }
  if (!invalidApprovalStatusFailed) throw new Error("invalid approval status should fail");

  let missingApprovalFailed = false;
  try {
    await client.getApproval("missing");
  } catch {
    missingApprovalFailed = true;
  }
  if (!missingApprovalFailed) throw new Error("missing approval should fail");

  let missingApprovalResolveFailed = false;
  try {
    await client.resolveApproval("missing", { decision: "deny" });
  } catch {
    missingApprovalResolveFailed = true;
  }
  if (!missingApprovalResolveFailed) throw new Error("missing approval resolve should fail");

  const approvalStore = new ApprovalStore(join(mkdtempSync(join(tmpdir(), "zuu-approval-check-")), "approvals.json"));
  const pendingApproval = approvalStore.create({
    sessionId: "check-session",
    runId: "check-run",
    kind: "tool",
    title: "Check approval",
    description: "Approval store contract check",
    risk: "medium",
  });
  if (approvalStore.list("pending")[0]?.id !== pendingApproval.id) {
    throw new Error("pending approval was not listed");
  }
  const resolvedApproval = approvalStore.resolve(pendingApproval.id, { decision: "allow_once" });
  if (resolvedApproval.status !== "allowed" || resolvedApproval.decision !== "allow_once") {
    throw new Error("approval was not resolved");
  }
  const consumedApproval = approvalStore.consumeGrant({ sessionId: "check-session", kind: "tool", scope: undefined });
  if (consumedApproval?.id !== pendingApproval.id || !consumedApproval.usedAt) {
    throw new Error("allow_once approval was not consumed");
  }
  if (approvalStore.consumeGrant({ sessionId: "check-session", kind: "tool", scope: undefined })) {
    throw new Error("allow_once approval should not be reusable");
  }
  const expiredApproval = approvalStore.create({
    sessionId: "check-session",
    runId: "check-run",
    kind: "command",
    title: "Expired check approval",
    description: "Approval expiration contract check",
    risk: "high",
    expiresAt: "1970-01-01T00:00:00.000Z",
  });
  if (approvalStore.get(expiredApproval.id).status !== "expired") {
    throw new Error("expired approval did not expire");
  }

  const extensionStore = new ApprovalStore(join(mkdtempSync(join(tmpdir(), "zuu-approval-extension-check-")), "approvals.json"));
  const extension = createApprovalExtension({
    approvals: extensionStore,
    getActiveRunId: (sessionId) => (sessionId === "extension-session" ? "extension-run" : undefined),
  });
  const toolCallHandlers: Array<(event: unknown, ctx: unknown) => unknown> = [];
  const approvalEvents: unknown[] = [];
  const eventBus = createEventBus();
  eventBus.on("zuu:approval", (event) => approvalEvents.push(event));
  const extensionFactory = typeof extension === "function" ? extension : extension.factory;
  await extensionFactory({
    on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
      if (event === "tool_call") toolCallHandlers.push(handler);
    },
    events: eventBus,
  } as never);
  const toolCallContext = {
    sessionManager: {
      getSessionId: () => "extension-session",
    },
  };
  const blocked = await toolCallHandlers[0]?.(
    { type: "tool_call", toolName: "bash", toolCallId: "tool-call-check", input: { command: "echo check" } },
    toolCallContext,
  );
  if (!blocked || typeof blocked !== "object" || !("block" in blocked) || blocked.block !== true) {
    throw new Error("approval extension should block unapproved dangerous tools");
  }
  const requested = extensionStore.list("pending")[0];
  if (!requested || requested.scope !== "tool:bash" || approvalEvents.length !== 1) {
    throw new Error("approval extension did not create a pending approval");
  }
  extensionStore.resolve(requested.id, { decision: "allow_session" });
  const allowed = await toolCallHandlers[0]?.(
    { type: "tool_call", toolName: "bash", toolCallId: "tool-call-check-2", input: { command: "echo check" } },
    toolCallContext,
  );
  if (allowed !== undefined || approvalEvents.length < 2) {
    throw new Error("approval extension should allow session-granted tools");
  }
  const safeRead = await toolCallHandlers[0]?.(
    { type: "tool_call", toolName: "read", toolCallId: "tool-call-safe-read", input: { path: "src/index.ts" } },
    toolCallContext,
  );
  if (safeRead !== undefined) {
    throw new Error("approval extension should allow non-sensitive read tools");
  }
  const sensitiveRead = await toolCallHandlers[0]?.(
    { type: "tool_call", toolName: "read", toolCallId: "tool-call-sensitive-read", input: { path: ".env" } },
    toolCallContext,
  );
  if (!sensitiveRead || typeof sensitiveRead !== "object" || !("block" in sensitiveRead) || sensitiveRead.block !== true) {
    throw new Error("approval extension should block sensitive read paths");
  }
  const sensitiveApproval = extensionStore.list("pending").find((approval) => approval.scope === "tool:read:sensitive_path");
  if (!sensitiveApproval || sensitiveApproval.kind !== "filesystem" || sensitiveApproval.risk !== "high") {
    throw new Error("sensitive read approval should use a filesystem scoped approval");
  }
  extensionStore.resolve(sensitiveApproval.id, { decision: "allow_session" });
  const allowedSensitiveRead = await toolCallHandlers[0]?.(
    { type: "tool_call", toolName: "read", toolCallId: "tool-call-sensitive-read-allowed", input: { path: ".env" } },
    toolCallContext,
  );
  if (allowedSensitiveRead !== undefined) {
    throw new Error("approval extension should allow session-granted sensitive reads");
  }

  const packages = await client.listPackages();
  if (!Array.isArray(packages.packages)) throw new Error("packages response is invalid");
  if (packages.packages.some((item) => typeof item.trusted !== "boolean" || !item.trustStatus)) {
    throw new Error("packages trust response is invalid");
  }
  if (packages.packages.some((item) => !item.loadStatus)) {
    throw new Error("packages load status response is invalid");
  }
  const packageOperations = await client.listPackageOperations();
  if (!Array.isArray(packageOperations.operations)) throw new Error("package operations response is invalid");
  let missingPackageOperationFailed = false;
  try {
    await client.getPackageOperation("missing");
  } catch {
    missingPackageOperationFailed = true;
  }
  if (!missingPackageOperationFailed) throw new Error("missing package operation should fail");
  const models = await client.listModels();
  if (!Array.isArray(models.models)) throw new Error("models response is invalid");
  let smokeRequestPath = "";
  let smokeRequestBody: unknown;
  const smokeClient = createZuuClient({
    baseUrl: "http://zuu.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      smokeRequestPath = new URL(request.url).pathname;
      smokeRequestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return Response.json({
        ok: true,
        status: "completed",
        startedAt: "2026-08-12T00:00:00.000Z",
        finishedAt: "2026-08-12T00:00:01.000Z",
        durationMs: 1000,
        eventCount: 2,
        runId: "model-smoke-check",
      });
    },
  });
  const modelSmoke = await smokeClient.smokeModel({
    model: { provider: "deepseek", id: "deepseek-chat" },
    timeoutMs: 1000,
  });
  if (
    !modelSmoke.ok ||
    smokeRequestPath !== "/v1/models/smoke" ||
    !smokeRequestBody ||
    typeof smokeRequestBody !== "object" ||
    !("model" in smokeRequestBody)
  ) {
    throw new Error("model smoke client method should call the smoke route with a model body");
  }
  await expectClientError(() => client.smokeModel({ timeoutMs: 999 }), {
    status: 400,
    code: "validation_failed",
    details: (details) => Boolean(details && typeof details === "object" && "field" in details),
  });

  await expectClientError(() => client.addPackage({ source: " " }), {
    status: 400,
    code: "validation_failed",
    details: (details) => Boolean(details && typeof details === "object" && "field" in details),
  });
  let emptyPackageInstallFailed = false;
  try {
    await client.installPackage({ source: " " });
  } catch {
    emptyPackageInstallFailed = true;
  }
  if (!emptyPackageInstallFailed) throw new Error("empty package install source should fail");
  const untrustedSource = `npm:zuu-check-untrusted-${crypto.randomUUID()}`;
  let untrustedPackageInstallFailed = false;
  try {
    await client.installPackage({ source: untrustedSource });
  } catch {
    untrustedPackageInstallFailed = true;
  }
  if (!untrustedPackageInstallFailed) throw new Error("untrusted package install should fail before network work starts");
  let untrustedPackageUpdateFailed = false;
  try {
    await client.updatePackage({ source: untrustedSource });
  } catch {
    untrustedPackageUpdateFailed = true;
  }
  if (!untrustedPackageUpdateFailed) throw new Error("untrusted package update should fail before network work starts");
  let emptyPackageTrustFailed = false;
  try {
    await client.trustPackage({ source: " " });
  } catch {
    emptyPackageTrustFailed = true;
  }
  if (!emptyPackageTrustFailed) throw new Error("empty package trust source should fail");

  const trustStore = new PackageTrustStore(join(mkdtempSync(join(tmpdir(), "zuu-package-trust-check-")), "trust.json"));
  const trustedPackage = trustStore.trust("npm:check-package");
  if (trustedPackage.status !== "trusted" || !trustStore.isTrusted("npm:check-package")) {
    throw new Error("package trust was not recorded");
  }
  const untrustedPackage = trustStore.revoke("npm:check-package");
  if (untrustedPackage.status !== "untrusted" || trustStore.isTrusted("npm:check-package")) {
    throw new Error("package trust was not revoked");
  }

  const corruptStoreDir = mkdtempSync(join(tmpdir(), "zuu-json-store-check-"));
  const corruptRunsPath = join(corruptStoreDir, "runs.json");
  writeFileSync(corruptRunsPath, "{not json", "utf8");
  const recoveredRuns = loadRunHistory(corruptRunsPath);
  if (recoveredRuns.length !== 0) {
    throw new Error("corrupt run history should recover to an empty list");
  }
  const corruptBackups = readdirSync(corruptStoreDir).filter((name) => name.startsWith("runs.json.corrupt-"));
  if (corruptBackups.length !== 1) {
    throw new Error("corrupt run history should be backed up");
  }
  const recoveredPayload = JSON.parse(readFileSync(corruptRunsPath, "utf8")) as { version?: number; data?: unknown };
  if (recoveredPayload.version !== 1 || !Array.isArray(recoveredPayload.data)) {
    throw new Error("corrupt run history should be rewritten as a versioned store");
  }
  saveRunHistory(corruptRunsPath, [
    {
      id: "store-check-run",
      sessionId: "store-check-session",
      projectId: "default",
      source: "api",
      status: "completed",
      prompt: "store check",
      startedAt: "2026-08-12T00:00:00.000Z",
      finishedAt: "2026-08-12T00:00:01.000Z",
    },
  ]);
  const savedPayload = JSON.parse(readFileSync(corruptRunsPath, "utf8")) as { version?: number; data?: unknown };
  if (savedPayload.version !== 1 || !Array.isArray(savedPayload.data) || savedPayload.data.length !== 1) {
    throw new Error("run history should save through the versioned JSON store");
  }

  const projectStoreDir = mkdtempSync(join(tmpdir(), "zuu-project-store-check-"));
  const projectStore = new ProjectStore(join(projectStoreDir, "projects.json"), projectStoreDir);
  const storedProject = projectStore.create({ cwd: process.cwd(), name: "stored project" });
  if (projectStore.get(storedProject.id).name !== "stored project") {
    throw new Error("project store should persist created projects");
  }
  projectStore.update(storedProject.id, { name: "updated stored project" });
  if (projectStore.delete(storedProject.id).name !== "updated stored project") {
    throw new Error("project store should update and delete projects");
  }

  const runEventStorePath = join(mkdtempSync(join(tmpdir(), "zuu-run-event-check-")), "run-events.json");
  const runEventStore = new RunEventStore(runEventStorePath);
  const recordRunEvent = runEventStore.createRecorder("event-check-run");
  const firstRunEvent = recordRunEvent({ runId: "event-check-run", type: "text_delta", delta: "hello" });
  const secondRunEvent = recordRunEvent({ runId: "event-check-run", type: "done" });
  if (firstRunEvent.id !== "event-check-run:1" || secondRunEvent.id !== "event-check-run:2") {
    throw new Error("run events should receive stable sequence IDs");
  }
  const reloadedRunEventStore = new RunEventStore(runEventStorePath);
  const replayedRunEvents = reloadedRunEventStore.list("event-check-run", firstRunEvent.id);
  if (replayedRunEvents.length !== 1 || replayedRunEvents[0]?.id !== secondRunEvent.id) {
    throw new Error("run event replay should return events after the requested event ID");
  }

  const packageServiceAgentDir = mkdtempSync(join(tmpdir(), "zuu-package-service-check-"));
  const packageService = new PackageService(
    process.cwd(),
    packageServiceAgentDir,
    join(packageServiceAgentDir, "operations.json"),
    join(packageServiceAgentDir, "trust.json"),
  );
  await packageService.add({ source: "npm:zuu-check-package" });
  const blockedPackage = packageService.list().packages.find((item) => item.source === "npm:zuu-check-package");
  if (blockedPackage?.loadStatus !== "blocked" || packageService.listTrustedPackageSources().length !== 0) {
    throw new Error("untrusted package should be blocked from the trusted settings view");
  }
  packageService.trustPackage({ source: "npm:zuu-check-package" });
  const enabledPackage = packageService.list().packages.find((item) => item.source === "npm:zuu-check-package");
  if (enabledPackage?.loadStatus !== "enabled" || packageService.listTrustedPackageSources()[0] !== "npm:zuu-check-package") {
    throw new Error("trusted package should be enabled in the trusted settings view");
  }
  const packageAuditSource = `npm:zuu-check-audit-${crypto.randomUUID()}`;
  await client.addPackage({ source: packageAuditSource });
  await client.trustPackage({ source: packageAuditSource });
  const mutatingAuditEvents = await client.listAuditEvents({ action: "api.mutate", outcome: "success", target: "/v1/packages/trust", limit: 20 });
  if (!mutatingAuditEvents.events.some((event) => event.target === "POST /v1/packages/trust")) {
    throw new Error("successful mutating API calls should be recorded in audit events");
  }
  const latestAuditEvents = await client.listAuditEvents(20);
  if (!latestAuditEvents.events.some((event) => event.action === "package.trust" && event.target === packageAuditSource)) {
    throw new Error("package trust should be recorded in audit events");
  }
  const filteredAuditEvents = await client.listAuditEvents({ action: "package.trust", target: packageAuditSource, limit: 5 });
  if (filteredAuditEvents.events.length !== 1 || filteredAuditEvents.events[0]?.target !== packageAuditSource) {
    throw new Error("audit events should be filterable by action and target");
  }
  await expectClientError(() => client.listAuditEvents({ action: "package.trust" as never, outcome: "invalid" as never }), {
    status: 400,
    code: "validation_failed",
  });

  const storedBefore = await client.listStoredSessions();
  if (!Array.isArray(storedBefore.sessions)) throw new Error("stored sessions response is invalid");

  await expectClientError(() => drainStream(client.promptSession("missing", { prompt: "session prompt check" })), {
    status: 404,
    code: "not_found",
  });
  await expectClientError(() => drainStream(client.steerSession("missing", { prompt: "steer check" })), {
    status: 404,
    code: "not_found",
  });
  await expectClientError(() => drainStream(client.followUpSession("missing", { prompt: "follow-up check" })), {
    status: 404,
    code: "not_found",
  });

  const sessionPromptRequests: Array<{ path: string; body: unknown }> = [];
  const sessionPromptClient = createZuuClient({
    baseUrl: "http://zuu.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      sessionPromptRequests.push({
        path: new URL(request.url).pathname,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const event = {
        id: "session-prompt-route:1",
        createdAt: "2026-08-12T00:00:00.000Z",
        runId: "session-prompt-route",
        type: "done",
      };
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`id: ${event.id}\nevent: done\ndata: ${JSON.stringify(event)}\n\n`));
            controller.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  await drainStream(sessionPromptClient.promptSession("session/check", { prompt: "prompt route" }));
  await drainStream(sessionPromptClient.steerSession("session/check", { prompt: "steer route" }));
  await drainStream(sessionPromptClient.followUpSession("session/check", { prompt: "follow-up route" }));
  if (
    sessionPromptRequests.map((request) => request.path).join(",") !==
    "/v1/sessions/session%2Fcheck/prompts,/v1/sessions/session%2Fcheck/steer,/v1/sessions/session%2Fcheck/follow-ups"
  ) {
    throw new Error("session prompt client methods should target the session-scoped routes");
  }

  let observedStreamingBehavior: unknown;
  let runEventSequence = 0;
  const busySession = {
    sessionId: "busy-session",
    isStreaming: true,
    prompt: async (_prompt: string, options?: { streamingBehavior?: string }) => {
      observedStreamingBehavior = options?.streamingBehavior;
    },
    subscribe: () => () => {},
    setActiveToolsByName: () => {},
  };
  const promptService = new PromptService({
    sessions: {
      getOrCreateSession: async () => busySession,
      touchSession: () => {},
      getProjectId: () => "default",
      summarizeSession: () => ({
        id: "busy-session",
        projectId: "default",
        cwd: process.cwd(),
        thinkingLevel: "medium",
        activeTools: [],
        messageCount: 0,
        isStreaming: true,
        createdAt: "2026-08-12T00:00:00.000Z",
        updatedAt: "2026-08-12T00:00:00.000Z",
      }),
    },
    runs: {
      startRun: () => ({
        id: "busy-run",
        sessionId: "busy-session",
        projectId: "default",
        source: "user",
        status: "running",
        prompt: "busy",
        startedAt: "2026-08-12T00:00:00.000Z",
      }),
      createEventRecorder: (runId: string) => (event: { runId: string; type: string }) => ({
        id: `${runId}:${++runEventSequence}`,
        createdAt: "2026-08-12T00:00:00.000Z",
        ...event,
      }),
      saveRun: () => {},
    },
    eventBus: { on: () => () => {} },
    activeRunBySessionId: new Map<string, string>(),
  } as never);
  try {
    await promptService.prompt({ sessionId: "busy-session", prompt: "busy" }).next();
    throw new Error("busy session prompt should fail before streaming");
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409 || error.code !== "session_busy") {
      throw new Error("busy session prompt should fail with session_busy");
    }
  }
  for await (const event of promptService.prompt({
    sessionId: "busy-session",
    prompt: "steer",
    streamingBehavior: "steer",
  })) {
    if (event.type === "done") break;
  }
  if (observedStreamingBehavior !== "steer") {
    throw new Error("prompt service should pass streamingBehavior to the Pi SDK session");
  }

  let pathGuardFailed = false;
  try {
    await client.createSession({ cwd: "..", persist: false });
  } catch {
    pathGuardFailed = true;
  }
  if (!pathGuardFailed) throw new Error("cwd outside allowed roots should fail");

  const { session } = await client.createSession({ persist: false, name: "check" });
  const tree = await client.getSessionTree(session.id);
  if (!Array.isArray(tree.tree)) throw new Error("session tree response is invalid");

  const replaced = await client.newSession(session.id, { name: "check next" });
  if (replaced.cancelled || replaced.session.id === session.id) {
    throw new Error("newSession did not replace the active session");
  }

  const persisted = await client.createProjectSession(defaultProject.id, { name: "stored check" });
  if (!persisted.session.sessionFile) throw new Error("persisted session is missing sessionFile");
  const opened = await client.openProjectSession(defaultProject.id, { sessionFile: persisted.session.sessionFile });
  if (opened.session.id !== persisted.session.id) throw new Error("openSession returned the wrong session");

  await expectClientError(() => client.getRun("missing"), { status: 404, code: "not_found" });
  await expectClientError(() => client.listScheduleRuns("missing"), { status: 404, code: "not_found" });
  await expectClientError(() => client.getScheduleRun("missing"), { status: 404, code: "not_found" });
  await expectClientError(() => client.abortScheduleRun("missing"), { status: 404, code: "not_found" });

  console.log("ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
