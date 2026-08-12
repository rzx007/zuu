import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { ZuuDaemon } from "./agent-daemon";
import type {
  ApprovalStatus,
  CreateScheduleRequest,
  ForkSessionRequest,
  ImportSessionRequest,
  NewSessionRequest,
  OpenSessionRequest,
  PackageMutationRequest,
  PromptRequest,
  ResolveApprovalRequest,
  StartWorkflowRequest,
  SwitchSessionRequest,
} from "@zuu/client";

const app = new Hono();
const daemon = new ZuuDaemon();
const webDistRoot = "./web/dist";
const webIndex = new URL("../web/dist/index.html", import.meta.url);
const hasWebDist = existsSync(webIndex);

function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : String(error);
  return { error: { message, status } };
}

function isAuthorized(authorization: string | undefined) {
  const apiToken = process.env.ZUU_API_TOKEN?.trim();
  return !apiToken || authorization === `Bearer ${apiToken}`;
}

app.use("/api/*", async (c, next) => {
  if (!isAuthorized(c.req.header("authorization"))) {
    return c.json(jsonError("Unauthorized", 401), 401);
  }

  await next();
});

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/diagnostics", async (c) => {
  try {
    return c.json(await daemon.diagnostics());
  } catch (error) {
    return c.json(jsonError(error, 500), 500);
  }
});

app.get("/api/packages", (c) => c.json(daemon.listPackages()));

app.get("/api/package-operations", (c) => c.json(daemon.listPackageOperations()));

app.get("/api/package-operations/:operationId", (c) => {
  try {
    return c.json(daemon.getPackageOperation(c.req.param("operationId")));
  } catch (error) {
    return c.json(jsonError(error, 404), 404);
  }
});

app.get("/api/models", async (c) => {
  try {
    return c.json(await daemon.listModels());
  } catch (error) {
    return c.json(jsonError(error, 500), 500);
  }
});

app.post("/api/packages", async (c) => {
  try {
    const body = (await c.req.json()) as PackageMutationRequest;
    return c.json(await daemon.addPackage(body));
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

app.post("/api/packages/install", async (c) => {
  try {
    const body = (await c.req.json()) as PackageMutationRequest;
    return c.json(await daemon.installPackage(body));
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

app.delete("/api/packages", async (c) => {
  try {
    const body = (await c.req.json()) as PackageMutationRequest;
    return c.json(await daemon.removePackage(body));
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

app.post("/api/packages/trust", async (c) => {
  try {
    const body = (await c.req.json()) as PackageMutationRequest;
    return c.json(daemon.trustPackage(body));
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

app.delete("/api/packages/trust", async (c) => {
  try {
    const body = (await c.req.json()) as PackageMutationRequest;
    return c.json(daemon.revokePackageTrust(body));
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

app.get("/api/sessions", (c) => c.json({ sessions: daemon.listSessions() }));

app.get("/api/session-files", async (c) => {
  try {
    return c.json({ sessions: await daemon.listStoredSessions(c.req.query("cwd")) });
  } catch (error) {
    return c.json(jsonError(error, 500), 500);
  }
});

app.get("/api/sessions/:sessionId/tree", (c) => {
  try {
    return c.json({ tree: daemon.summarizeSessionTree(c.req.param("sessionId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), 404);
  }
});

app.get("/api/runs", (c) => {
  const sessionId = c.req.query("sessionId");
  return c.json({ runs: daemon.listRuns(sessionId) });
});

app.get("/api/runs/:runId", (c) => {
  try {
    return c.json({ run: daemon.getRun(c.req.param("runId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), 404);
  }
});

app.get("/api/workflows", async (c) => {
  try {
    return c.json(await daemon.listWorkflows());
  } catch (error) {
    return c.json(jsonError(error, 500), 500);
  }
});

app.post("/api/workflows/:workflowId/runs", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as StartWorkflowRequest;
    return c.json({ run: await daemon.startWorkflow(c.req.param("workflowId"), body) }, 201);
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

app.get("/api/workflow-runs", async (c) => {
  try {
    return c.json({ runs: await daemon.listWorkflowRuns() });
  } catch (error) {
    return c.json(jsonError(error, 500), 500);
  }
});

app.get("/api/workflow-runs/:runId", async (c) => {
  try {
    return c.json({ run: await daemon.getWorkflowRun(c.req.param("runId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), 404);
  }
});

app.post("/api/workflow-runs/:runId/abort", async (c) => {
  try {
    return c.json({ run: await daemon.abortWorkflowRun(c.req.param("runId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), 404);
  }
});

app.get("/api/schedules", (c) => {
  try {
    return c.json({ schedules: daemon.listSchedules() });
  } catch (error) {
    return c.json(jsonError(error, 500), 500);
  }
});

app.post("/api/schedules", async (c) => {
  try {
    const body = (await c.req.json()) as CreateScheduleRequest;
    return c.json({ schedule: daemon.createSchedule(body) }, 201);
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

app.get("/api/schedules/:scheduleId", (c) => {
  try {
    return c.json({ schedule: daemon.getSchedule(c.req.param("scheduleId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), 404);
  }
});

app.post("/api/schedules/:scheduleId/pause", (c) => {
  try {
    return c.json({ schedule: daemon.pauseSchedule(c.req.param("scheduleId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), 404);
  }
});

app.post("/api/schedules/:scheduleId/resume", (c) => {
  try {
    return c.json({ schedule: daemon.resumeSchedule(c.req.param("scheduleId")) });
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

app.post("/api/schedules/:scheduleId/trigger", async (c) => {
  try {
    return c.json({ schedule: await daemon.triggerSchedule(c.req.param("scheduleId")) });
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

app.delete("/api/schedules/:scheduleId", (c) => {
  try {
    return c.json({ schedule: daemon.deleteSchedule(c.req.param("scheduleId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), 404);
  }
});

app.get("/api/approvals", (c) => {
  try {
    return c.json({ approvals: daemon.listApprovals(c.req.query("status") as ApprovalStatus | undefined) });
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

app.get("/api/approvals/:approvalId", (c) => {
  try {
    return c.json({ approval: daemon.getApproval(c.req.param("approvalId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), 404);
  }
});

app.post("/api/approvals/:approvalId/resolve", async (c) => {
  try {
    const body = (await c.req.json()) as ResolveApprovalRequest;
    return c.json({ approval: daemon.resolveApproval(c.req.param("approvalId"), body) });
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

app.post("/api/sessions", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const session = await daemon.createSession(body);
    return c.json({ session: daemon.summarizeSession(session) }, 201);
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

app.post("/api/sessions/open", async (c) => {
  try {
    const body = (await c.req.json()) as OpenSessionRequest;
    const session = await daemon.openSession(body);
    return c.json({ session: daemon.summarizeSession(session) }, 201);
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

app.post("/api/prompt", async (c) => {
  let request: PromptRequest;
  try {
    request = await c.req.json();
    if (!request.prompt || typeof request.prompt !== "string") {
      return c.json(jsonError("prompt is required", 400), 400);
    }
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }

  return streamSSE(c, async (stream) => {
    try {
      for await (const event of daemon.prompt(request)) {
        if (stream.aborted) break;
        await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      }
    } catch (error) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({
          runId: "unknown",
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
      });
    }
  });
});

app.post("/api/sessions/:sessionId/abort", async (c) => {
  try {
    const session = await daemon.abort(c.req.param("sessionId"));
    return c.json({ session });
  } catch (error) {
    return c.json(jsonError(error, 404), 404);
  }
});

app.post("/api/sessions/:sessionId/compact", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const session = await daemon.compact(c.req.param("sessionId"), body.instructions);
    return c.json({ session });
  } catch (error) {
    return c.json(jsonError(error, 404), 404);
  }
});

app.post("/api/sessions/:sessionId/new", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as NewSessionRequest;
    return c.json(await daemon.newSession(c.req.param("sessionId"), body));
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

app.post("/api/sessions/:sessionId/switch", async (c) => {
  try {
    const body = (await c.req.json()) as SwitchSessionRequest;
    return c.json(await daemon.switchSession(c.req.param("sessionId"), body));
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

app.post("/api/sessions/:sessionId/fork", async (c) => {
  try {
    const body = (await c.req.json()) as ForkSessionRequest;
    return c.json(await daemon.forkSession(c.req.param("sessionId"), body));
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

app.post("/api/sessions/:sessionId/import", async (c) => {
  try {
    const body = (await c.req.json()) as ImportSessionRequest;
    return c.json(await daemon.importSession(c.req.param("sessionId"), body));
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

if (hasWebDist) {
  app.get("/assets/*", serveStatic({ root: webDistRoot }));
  app.get("/favicon.svg", serveStatic({ root: webDistRoot }));
}

app.get("/*", async (c) => {
  try {
    return c.html(await readFile(webIndex, "utf8"));
  } catch {
    return c.html(
      "<!doctype html><title>Zuu Agent</title><main style=\"font:14px system-ui;padding:24px\">Web UI 尚未构建。请运行 <code>pnpm --filter web build</code>，或开发时运行 <code>pnpm --filter web dev</code>。</main>",
      503,
    );
  }
});

function closeServer(server: ServerType) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function startServer(port = Number(process.env.PORT ?? 3001)) {
  const server = serve({ fetch: app.fetch, port });
  console.log(`Zuu Agent listening on http://localhost:${port}`);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = startServer();
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down Zuu Agent...`);

    try {
      await closeServer(server);
      await daemon.dispose();
      process.exit(0);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

export default app;
