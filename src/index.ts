import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { ZuuDaemon } from "./agent-daemon";
import { jsonError, readJson, toStatus } from "./http";
import {
  parseCompact,
  parseCreateProject,
  parseCreateSchedule,
  parseCreateSession,
  parseForkSession,
  parseImportSession,
  parseNewSession,
  parseOpenSession,
  parsePackageMutation,
  parsePrompt,
  parseResolveApproval,
  parseStartWorkflow,
  parseSwitchSession,
  parseUpdateProject,
} from "./request-validation";
import type {
  ApprovalStatus,
  EventStreamQuery,
  PromptStreamEvent,
  PromptRequest,
} from "@zuu/client";

const app = new Hono();
const daemon = new ZuuDaemon();
const webDistRoot = "./web/dist";
const webIndex = new URL("../web/dist/index.html", import.meta.url);
const hasWebDist = existsSync(webIndex);

function isAuthorized(authorization: string | undefined) {
  const apiToken = process.env.ZUU_API_TOKEN?.trim();
  return !apiToken || authorization === `Bearer ${apiToken}`;
}

app.use("/v1/*", async (c, next) => {
  if (!isAuthorized(c.req.header("authorization"))) {
    return c.json(jsonError("Unauthorized", 401), 401);
  }

  await next();
});

app.all("/api/*", (c) => c.json(jsonError("Use /v1 instead of /api.", 404), 404));

app.get("/v1/health", (c) => c.json({ ok: true }));

app.get("/v1/diagnostics", async (c) => {
  try {
    return c.json(await daemon.diagnostics());
  } catch (error) {
    return c.json(jsonError(error, 500), toStatus(error, 500));
  }
});

app.get("/v1/packages", (c) => c.json(daemon.listPackages()));

app.get("/v1/package-operations", (c) => c.json(daemon.listPackageOperations()));

app.get("/v1/package-operations/:operationId", (c) => {
  try {
    return c.json(daemon.getPackageOperation(c.req.param("operationId")));
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.get("/v1/models", async (c) => {
  try {
    return c.json(await daemon.listModels());
  } catch (error) {
    return c.json(jsonError(error, 500), toStatus(error, 500));
  }
});

app.get("/v1/projects", (c) => c.json({ projects: daemon.listProjects() }));

app.post("/v1/projects", async (c) => {
  try {
    const body = parseCreateProject(await readJson(c.req));
    return c.json({ project: daemon.createProject(body) }, 201);
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.get("/v1/projects/:projectId", (c) => {
  try {
    return c.json({ project: daemon.getProject(c.req.param("projectId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.patch("/v1/projects/:projectId", async (c) => {
  try {
    const body = parseUpdateProject(await readJson(c.req));
    return c.json({ project: daemon.updateProject(c.req.param("projectId"), body) });
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.delete("/v1/projects/:projectId", (c) => {
  try {
    return c.json({ project: daemon.deleteProject(c.req.param("projectId")) });
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.get("/v1/projects/:projectId/sessions", (c) => {
  try {
    return c.json({ sessions: daemon.listSessions(c.req.param("projectId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.post("/v1/projects/:projectId/sessions", async (c) => {
  try {
    const body = parseCreateSession(await readJson(c.req, { optional: true }));
    const session = await daemon.createSession({ ...body, projectId: c.req.param("projectId") });
    return c.json({ session: daemon.summarizeSession(session) }, 201);
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.get("/v1/projects/:projectId/session-files", async (c) => {
  try {
    return c.json({ sessions: await daemon.listStoredSessions(undefined, c.req.param("projectId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.post("/v1/projects/:projectId/sessions/open", async (c) => {
  try {
    const body = parseOpenSession(await readJson(c.req));
    const session = await daemon.openSession({ ...body, projectId: c.req.param("projectId") });
    return c.json({ session: daemon.summarizeSession(session) }, 201);
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.get("/v1/projects/:projectId/runs", (c) => {
  try {
    return c.json({ runs: daemon.listRuns(c.req.query("sessionId"), c.req.param("projectId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.get("/v1/projects/:projectId/runs/:runId", (c) => {
  try {
    return c.json({ run: daemon.getRun(c.req.param("runId"), c.req.param("projectId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.get("/v1/projects/:projectId/runs/:runId/events", (c) => {
  try {
    return c.json({
      events: daemon.listRunEvents(c.req.param("runId"), c.req.query("afterEventId"), c.req.param("projectId")),
    });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.get("/v1/projects/:projectId/workflows", async (c) => {
  try {
    return c.json(await daemon.listWorkflows(c.req.param("projectId")));
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.post("/v1/projects/:projectId/workflows/:workflowId/runs", async (c) => {
  try {
    const body = parseStartWorkflow(await readJson(c.req, { optional: true }));
    return c.json({ run: await daemon.startWorkflow(c.req.param("workflowId"), body, c.req.param("projectId")) }, 201);
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.get("/v1/projects/:projectId/workflow-runs", async (c) => {
  try {
    return c.json({ runs: await daemon.listWorkflowRuns(c.req.param("projectId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.get("/v1/projects/:projectId/workflow-runs/:runId", async (c) => {
  try {
    return c.json({ run: await daemon.getWorkflowRun(c.req.param("runId"), c.req.param("projectId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.post("/v1/projects/:projectId/workflow-runs/:runId/abort", async (c) => {
  try {
    return c.json({ run: await daemon.abortWorkflowRun(c.req.param("runId"), c.req.param("projectId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.get("/v1/projects/:projectId/schedules", (c) => {
  try {
    return c.json({ schedules: daemon.listSchedules(c.req.param("projectId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.post("/v1/projects/:projectId/schedules", async (c) => {
  try {
    const body = parseCreateSchedule(await readJson(c.req));
    return c.json({ schedule: daemon.createSchedule(body, c.req.param("projectId")) }, 201);
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.get("/v1/projects/:projectId/schedules/:scheduleId", (c) => {
  try {
    return c.json({ schedule: daemon.getSchedule(c.req.param("scheduleId"), c.req.param("projectId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.post("/v1/projects/:projectId/schedules/:scheduleId/pause", (c) => {
  try {
    return c.json({ schedule: daemon.pauseSchedule(c.req.param("scheduleId"), c.req.param("projectId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.post("/v1/projects/:projectId/schedules/:scheduleId/resume", (c) => {
  try {
    return c.json({ schedule: daemon.resumeSchedule(c.req.param("scheduleId"), c.req.param("projectId")) });
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.post("/v1/projects/:projectId/schedules/:scheduleId/trigger", async (c) => {
  try {
    return c.json({ schedule: await daemon.triggerSchedule(c.req.param("scheduleId"), c.req.param("projectId")) });
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.delete("/v1/projects/:projectId/schedules/:scheduleId", (c) => {
  try {
    return c.json({ schedule: daemon.deleteSchedule(c.req.param("scheduleId"), c.req.param("projectId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.post("/v1/packages", async (c) => {
  try {
    const body = parsePackageMutation(await readJson(c.req));
    return c.json(await daemon.addPackage(body));
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.post("/v1/packages/install", async (c) => {
  try {
    const body = parsePackageMutation(await readJson(c.req));
    return c.json(await daemon.installPackage(body));
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.post("/v1/packages/update", async (c) => {
  try {
    const body = parsePackageMutation(await readJson(c.req));
    return c.json(daemon.updatePackage(body));
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.delete("/v1/packages", async (c) => {
  try {
    const body = parsePackageMutation(await readJson(c.req));
    return c.json(daemon.removePackage(body));
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.post("/v1/packages/trust", async (c) => {
  try {
    const body = parsePackageMutation(await readJson(c.req));
    return c.json(daemon.trustPackage(body));
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.delete("/v1/packages/trust", async (c) => {
  try {
    const body = parsePackageMutation(await readJson(c.req));
    return c.json(daemon.revokePackageTrust(body));
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.get("/v1/sessions", (c) => {
  try {
    return c.json({ sessions: daemon.listSessions(c.req.query("projectId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.get("/v1/session-files", async (c) => {
  try {
    return c.json({ sessions: await daemon.listStoredSessions(c.req.query("cwd"), c.req.query("projectId")) });
  } catch (error) {
    return c.json(jsonError(error, 500), toStatus(error, 500));
  }
});

app.get("/v1/sessions/:sessionId/tree", (c) => {
  try {
    return c.json({ tree: daemon.summarizeSessionTree(c.req.param("sessionId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.get("/v1/runs", (c) => {
  const sessionId = c.req.query("sessionId");
  const projectId = c.req.query("projectId");
  return c.json({ runs: daemon.listRuns(sessionId, projectId) });
});

app.get("/v1/runs/:runId", (c) => {
  try {
    return c.json({ run: daemon.getRun(c.req.param("runId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.get("/v1/runs/:runId/events", (c) => {
  try {
    return c.json({ events: daemon.listRunEvents(c.req.param("runId"), c.req.query("afterEventId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.get("/v1/events", (c) => {
  const query: EventStreamQuery = {
    runId: c.req.query("runId"),
    sessionId: c.req.query("sessionId"),
    afterEventId: c.req.query("afterEventId") ?? c.req.header("last-event-id"),
  };
  const liveQuery: EventStreamQuery = {
    runId: query.runId,
    sessionId: query.sessionId,
  };
  let replayEvents: PromptStreamEvent[];
  try {
    replayEvents = daemon.listEvents(query);
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }

  return streamSSE(c, async (stream) => {
    const queue: PromptStreamEvent[] = [];
    let notify: (() => void) | undefined;
    const wake = () => {
      notify?.();
      notify = undefined;
    };
    const unsubscribe = daemon.subscribeEvents(liveQuery, (event) => {
      queue.push(event);
      wake();
    });

    try {
      for (const event of replayEvents) {
        if (stream.aborted) return;
        await writePromptStreamEvent(stream, event);
      }

      while (!stream.aborted) {
        const event = queue.shift();
        if (event) {
          await writePromptStreamEvent(stream, event);
          continue;
        }

        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            notify = undefined;
            resolve();
          }, 15_000);
          notify = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        if (!queue.length && !stream.aborted) {
          await stream.writeSSE({ event: "heartbeat", data: "{}" });
        }
      }
    } finally {
      unsubscribe();
    }
  });
});

app.get("/v1/workflows", async (c) => {
  try {
    return c.json(await daemon.listWorkflows());
  } catch (error) {
    return c.json(jsonError(error, 500), toStatus(error, 500));
  }
});

app.post("/v1/workflows/:workflowId/runs", async (c) => {
  try {
    const body = parseStartWorkflow(await readJson(c.req, { optional: true }));
    return c.json({ run: await daemon.startWorkflow(c.req.param("workflowId"), body) }, 201);
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.get("/v1/workflow-runs", async (c) => {
  try {
    return c.json({ runs: await daemon.listWorkflowRuns(c.req.query("projectId")) });
  } catch (error) {
    return c.json(jsonError(error, c.req.query("projectId") ? 404 : 500), toStatus(error, c.req.query("projectId") ? 404 : 500));
  }
});

app.get("/v1/workflow-runs/:runId", async (c) => {
  try {
    return c.json({ run: await daemon.getWorkflowRun(c.req.param("runId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.post("/v1/workflow-runs/:runId/abort", async (c) => {
  try {
    return c.json({ run: await daemon.abortWorkflowRun(c.req.param("runId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.get("/v1/schedules", (c) => {
  try {
    return c.json({ schedules: daemon.listSchedules(c.req.query("projectId")) });
  } catch (error) {
    return c.json(jsonError(error, c.req.query("projectId") ? 404 : 500), toStatus(error, c.req.query("projectId") ? 404 : 500));
  }
});

app.post("/v1/schedules", async (c) => {
  try {
    const body = parseCreateSchedule(await readJson(c.req));
    return c.json({ schedule: daemon.createSchedule(body) }, 201);
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.get("/v1/schedules/:scheduleId", (c) => {
  try {
    return c.json({ schedule: daemon.getSchedule(c.req.param("scheduleId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.post("/v1/schedules/:scheduleId/pause", (c) => {
  try {
    return c.json({ schedule: daemon.pauseSchedule(c.req.param("scheduleId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.post("/v1/schedules/:scheduleId/resume", (c) => {
  try {
    return c.json({ schedule: daemon.resumeSchedule(c.req.param("scheduleId")) });
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.post("/v1/schedules/:scheduleId/trigger", async (c) => {
  try {
    return c.json({ schedule: await daemon.triggerSchedule(c.req.param("scheduleId")) });
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.delete("/v1/schedules/:scheduleId", (c) => {
  try {
    return c.json({ schedule: daemon.deleteSchedule(c.req.param("scheduleId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.get("/v1/approvals", (c) => {
  try {
    return c.json({ approvals: daemon.listApprovals(c.req.query("status") as ApprovalStatus | undefined) });
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.get("/v1/approvals/:approvalId", (c) => {
  try {
    return c.json({ approval: daemon.getApproval(c.req.param("approvalId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.post("/v1/approvals/:approvalId/resolve", async (c) => {
  try {
    const body = parseResolveApproval(await readJson(c.req));
    return c.json({ approval: daemon.resolveApproval(c.req.param("approvalId"), body) });
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.post("/v1/sessions", async (c) => {
  try {
    const body = parseCreateSession(await readJson(c.req, { optional: true }));
    const session = await daemon.createSession(body);
    return c.json({ session: daemon.summarizeSession(session) }, 201);
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.post("/v1/sessions/open", async (c) => {
  try {
    const body = parseOpenSession(await readJson(c.req));
    const session = await daemon.openSession(body);
    return c.json({ session: daemon.summarizeSession(session) }, 201);
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.post("/v1/prompt", async (c) => {
  let request: PromptRequest;
  try {
    request = parsePrompt(await readJson(c.req));
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }

  return streamSSE(c, async (stream) => {
    try {
      for await (const event of daemon.prompt(request)) {
        if (stream.aborted) break;
        await writePromptStreamEvent(stream, event);
      }
    } catch (error) {
      const event: PromptStreamEvent = {
        id: `unknown:${crypto.randomUUID()}`,
        createdAt: new Date().toISOString(),
        runId: "unknown",
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      };
      await stream.writeSSE({
        id: event.id,
        event: event.type,
        data: JSON.stringify(event),
      });
    }
  });
});

function writePromptStreamEvent(
  stream: Parameters<Parameters<typeof streamSSE>[1]>[0],
  event: PromptStreamEvent,
) {
  return stream.writeSSE({
    id: event.id,
    event: event.type,
    data: JSON.stringify(event),
  });
}

app.post("/v1/sessions/:sessionId/abort", async (c) => {
  try {
    const session = await daemon.abort(c.req.param("sessionId"));
    return c.json({ session });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.post("/v1/sessions/:sessionId/compact", async (c) => {
  try {
    const body = parseCompact(await readJson(c.req, { optional: true }));
    const session = await daemon.compact(c.req.param("sessionId"), body.instructions);
    return c.json({ session });
  } catch (error) {
    return c.json(jsonError(error, 404), toStatus(error, 404));
  }
});

app.post("/v1/sessions/:sessionId/new", async (c) => {
  try {
    const body = parseNewSession(await readJson(c.req, { optional: true }));
    return c.json(await daemon.newSession(c.req.param("sessionId"), body));
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.post("/v1/sessions/:sessionId/switch", async (c) => {
  try {
    const body = parseSwitchSession(await readJson(c.req));
    return c.json(await daemon.switchSession(c.req.param("sessionId"), body));
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.post("/v1/sessions/:sessionId/fork", async (c) => {
  try {
    const body = parseForkSession(await readJson(c.req));
    return c.json(await daemon.forkSession(c.req.param("sessionId"), body));
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }
});

app.post("/v1/sessions/:sessionId/import", async (c) => {
  try {
    const body = parseImportSession(await readJson(c.req));
    return c.json(await daemon.importSession(c.req.param("sessionId"), body));
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
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
