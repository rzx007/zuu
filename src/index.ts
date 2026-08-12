import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createAuditMiddleware } from "./agent-daemon/audit-middleware";
import { AuditService } from "./agent-daemon/audit-service";
import type { AuthScope } from "./agent-daemon/auth-service";
import { AuthService } from "./agent-daemon/auth-service";
import { ZuuDaemon } from "./agent-daemon";
import { getAuditEventStorePath, getAuthTokenStorePath, getZuuAgentDir } from "./agent-daemon/environment";
import { jsonError } from "./http";
import { registerV1Routes } from "./routes";

const app = new Hono();
const agentDir = getZuuAgentDir();
export const audit = new AuditService(getAuditEventStorePath(agentDir));
export const auth = new AuthService(getAuthTokenStorePath(agentDir));
const daemon = new ZuuDaemon({ audit });
const webDistRoot = "./web/dist";
const webIndex = new URL("../web/dist/index.html", import.meta.url);
const hasWebDist = existsSync(webIndex);

app.use("/v1/*", async (c, next) => {
  if (c.req.path === "/v1/health") {
    await next();
    return;
  }

  const decision = auth.authorize(c.req.header("authorization"), requiredAuthScope(c.req.method));
  if (!decision.authorized) {
    if (decision.reason === "forbidden") {
      return c.json(jsonError("Forbidden", 403), 403);
    }
    return c.json(jsonError("Unauthorized", 401), 401);
  }

  await next();
});

app.use("/v1/*", createAuditMiddleware(audit));

app.all("/api/*", (c) => c.json(jsonError("Use /v1 instead of /api.", 404), 404));

registerV1Routes({ app, audit, auth, daemon });

if (hasWebDist) {
  app.get("/assets/*", serveStatic({ root: webDistRoot }));
  app.get("/favicon.svg", serveStatic({ root: webDistRoot }));
}

app.get("/*", async (c) => {
  try {
    return c.html(await readFile(webIndex, "utf8"));
  } catch {
    return c.html(
      '<!doctype html><title>Zuu Agent</title><main style="font:14px system-ui;padding:24px">Web UI has not been built. Run <code>pnpm --filter web build</code>, or use <code>pnpm --filter web dev</code> during development.</main>',
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
  console.log(auth.startupMessage());
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

function requiredAuthScope(method: string): AuthScope {
  return method === "GET" ? "read" : "admin";
}
