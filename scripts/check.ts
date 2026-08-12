import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "../src/index";
import { ApprovalStore } from "../src/agent-daemon/approval-store";
import { createApprovalExtension } from "../src/agent-daemon/approval-policy";
import { PackageService } from "../src/agent-daemon/packages";
import { PackageTrustStore } from "../src/agent-daemon/package-trust";
import { RunEventStore } from "../src/agent-daemon/run-events";
import { loadRunHistory, saveRunHistory } from "../src/agent-daemon/run-history";
import { createWorkflowBackend } from "../src/agent-daemon/workflows";
import { createZuuClient, ZuuClientError } from "@zuu/client";
import { createEventBus } from "@earendil-works/pi-coding-agent";

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

async function main() {
  const client = createZuuClient({ baseUrl: "http://zuu.local", fetch: fetchFromApp });
  const health = await client.health();
  if (!health.ok) throw new Error("health check failed");
  const legacyApi = await fetchFromApp("http://zuu.local/api/health");
  if (legacyApi.status !== 404) throw new Error("legacy /api routes should not be served");
  const legacyApiBody = await legacyApi.json() as { error?: { code?: string } };
  if (legacyApiBody.error?.code !== "not_found") throw new Error("legacy /api routes should return not_found");
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

  const previousToken = process.env.ZUU_API_TOKEN;
  try {
    process.env.ZUU_API_TOKEN = "server-check-token";
    const unauthorized = await fetchFromApp("http://zuu.local/v1/health");
    if (unauthorized.status !== 401) throw new Error("missing api token should be rejected");
    const unauthorizedBody = await unauthorized.json() as { error?: { code?: string; status?: number } };
    if (unauthorizedBody.error?.code !== "unauthorized" || unauthorizedBody.error.status !== 401) {
      throw new Error("unauthorized response should include a stable error code");
    }
    await expectClientError(() => client.health(), { status: 401, code: "unauthorized" });
    const authorizedClient = createZuuClient({
      baseUrl: "http://zuu.local",
      fetch: fetchFromApp,
      apiToken: "server-check-token",
    });
    await authorizedClient.health();
  } finally {
    if (previousToken === undefined) {
      delete process.env.ZUU_API_TOKEN;
    } else {
      process.env.ZUU_API_TOKEN = previousToken;
    }
  }

  const malformedJson = await fetchFromApp("http://zuu.local/v1/packages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  if (malformedJson.status !== 400) throw new Error("malformed JSON should be rejected");
  const malformedJsonBody = await malformedJson.json() as { error?: { code?: string } };
  if (malformedJsonBody.error?.code !== "invalid_json") throw new Error("malformed JSON response should include invalid_json");

  const { runs } = await client.listRuns();
  if (!Array.isArray(runs)) throw new Error("runs response is invalid");
  await expectClientError(() => client.listRunEvents("missing"), { status: 404, code: "not_found" });
  const missingEventStream = await fetchFromApp("http://zuu.local/v1/events?runId=missing");
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

  const workflows = await client.listWorkflows();
  if (!Array.isArray(workflows.workflows) || workflows.workflows.length === 0) {
    throw new Error("workflows response is invalid");
  }
  if (workflows.backend.kind !== "fake" || workflows.backend.status !== "ready") {
    throw new Error("workflow backend info is invalid");
  }
  const workflowRun = await client.startWorkflow(workflows.workflows[0].id, {
    prompt: "contract check",
    inputs: { source: "scripts/check.ts" },
  });
  if (workflowRun.run.status !== "done" || workflowRun.run.stages.length === 0 || workflowRun.run.tasks.length === 0) {
    throw new Error("workflow run response is invalid");
  }
  const workflowRuns = await client.listWorkflowRuns();
  if (!workflowRuns.runs.some((run) => run.id === workflowRun.run.id)) {
    throw new Error("workflow run was not listed");
  }
  const loadedWorkflowRun = await client.getWorkflowRun(workflowRun.run.id);
  if (loadedWorkflowRun.run.id !== workflowRun.run.id) {
    throw new Error("workflow run lookup returned the wrong run");
  }
  const abortedWorkflowRun = await client.abortWorkflowRun(workflowRun.run.id);
  if (abortedWorkflowRun.run.id !== workflowRun.run.id) {
    throw new Error("workflow run abort returned the wrong run");
  }
  await expectClientError(() => client.getWorkflowRun("missing"), { status: 404, code: "not_found" });
  let missingWorkflowFailed = false;
  try {
    await client.startWorkflow("missing");
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

  const schedulesBefore = await client.listSchedules();
  if (!Array.isArray(schedulesBefore.schedules)) throw new Error("schedules response is invalid");
  const schedule = await client.createSchedule({
    name: "check workflow schedule",
    trigger: { kind: "interval", everyMs: 60_000 },
    action: {
      type: "workflow",
      workflowId: workflows.workflows[0].id,
      prompt: "scheduled contract check",
      inputs: { source: "scripts/check.ts" },
    },
  });
  if (schedule.schedule.status !== "active" || !schedule.schedule.nextRunAt) {
    throw new Error("created schedule response is invalid");
  }
  const pausedSchedule = await client.pauseSchedule(schedule.schedule.id);
  if (pausedSchedule.schedule.status !== "paused" || pausedSchedule.schedule.nextRunAt) {
    throw new Error("pause schedule response is invalid");
  }
  const resumedSchedule = await client.resumeSchedule(schedule.schedule.id);
  if (resumedSchedule.schedule.status !== "active" || !resumedSchedule.schedule.nextRunAt) {
    throw new Error("resume schedule response is invalid");
  }
  const nextRunAtBeforeTrigger = resumedSchedule.schedule.nextRunAt;
  const triggeredSchedule = await client.triggerSchedule(schedule.schedule.id);
  const scheduleRun = triggeredSchedule.schedule.runs[0];
  if (scheduleRun?.status !== "done" || !scheduleRun.workflowRunId) {
    throw new Error("triggered schedule response is invalid");
  }
  if (triggeredSchedule.schedule.nextRunAt !== nextRunAtBeforeTrigger) {
    throw new Error("manual schedule trigger should preserve the next automatic run");
  }
  const loadedSchedule = await client.getSchedule(schedule.schedule.id);
  if (loadedSchedule.schedule.id !== schedule.schedule.id) {
    throw new Error("schedule lookup returned the wrong schedule");
  }
  const deletedSchedule = await client.deleteSchedule(schedule.schedule.id);
  if (deletedSchedule.schedule.id !== schedule.schedule.id) {
    throw new Error("delete schedule returned the wrong schedule");
  }
  let cronScheduleFailed = false;
  try {
    await client.createSchedule({
      trigger: { kind: "cron", cron: "* * * * *" },
      action: { type: "workflow", workflowId: workflows.workflows[0].id },
    });
  } catch {
    cronScheduleFailed = true;
  }
  if (!cronScheduleFailed) throw new Error("cron schedule should fail until a backend is installed");

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
    approvalStore: extensionStore,
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
      status: "done",
      prompt: "store check",
      startedAt: "2026-08-12T00:00:00.000Z",
      endedAt: "2026-08-12T00:00:01.000Z",
    },
  ]);
  const savedPayload = JSON.parse(readFileSync(corruptRunsPath, "utf8")) as { version?: number; data?: unknown };
  if (savedPayload.version !== 1 || !Array.isArray(savedPayload.data) || savedPayload.data.length !== 1) {
    throw new Error("run history should save through the versioned JSON store");
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

  const storedBefore = await client.listStoredSessions();
  if (!Array.isArray(storedBefore.sessions)) throw new Error("stored sessions response is invalid");

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

  const persisted = await client.createSession({ name: "stored check" });
  if (!persisted.session.sessionFile) throw new Error("persisted session is missing sessionFile");
  const opened = await client.openSession({ sessionFile: persisted.session.sessionFile });
  if (opened.session.id !== persisted.session.id) throw new Error("openSession returned the wrong session");

  await expectClientError(() => client.getRun("missing"), { status: 404, code: "not_found" });

  console.log("ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
