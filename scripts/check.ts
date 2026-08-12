import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "../src/index";
import { ApprovalStore } from "../src/agent-daemon/approval-store";
import { createApprovalExtension } from "../src/agent-daemon/approval-policy";
import { createZuuClient } from "@zuu/client";
import { createEventBus } from "@earendil-works/pi-coding-agent";

const fetchFromApp: typeof fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  return app.fetch(request);
};

async function main() {
  const client = createZuuClient({ baseUrl: "http://zuu.local", fetch: fetchFromApp });
  const health = await client.health();
  if (!health.ok) throw new Error("health check failed");

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
    const unauthorized = await fetchFromApp("http://zuu.local/api/health");
    if (unauthorized.status !== 401) throw new Error("missing api token should be rejected");
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

  const { runs } = await client.listRuns();
  if (!Array.isArray(runs)) throw new Error("runs response is invalid");

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
  const models = await client.listModels();
  if (!Array.isArray(models.models)) throw new Error("models response is invalid");

  let emptyPackageFailed = false;
  try {
    await client.addPackage({ source: " " });
  } catch {
    emptyPackageFailed = true;
  }
  if (!emptyPackageFailed) throw new Error("empty package source should fail");

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

  let missingRunFailed = false;
  try {
    await client.getRun("missing");
  } catch {
    missingRunFailed = true;
  }
  if (!missingRunFailed) throw new Error("missing run should fail");

  console.log("ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
