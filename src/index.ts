import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createAuditMiddleware } from "./agent-daemon/audit/audit-middleware";
import { AuditService } from "./agent-daemon/audit/audit-service";
import { createAuthMiddleware } from "./agent-daemon/auth/auth-middleware";
import { AuthService } from "./agent-daemon/auth/auth-service";
import { createDaemonServiceRegistry } from "./agent-daemon/core/daemon-service-registry";
import { getAuditEventStorePath, getAuthTokenStorePath, getZuuAgentDir } from "./agent-daemon/core/agent-paths";
import { jsonError } from "./http";
import { registerV1Routes } from "./routes";
import { resolveServerAddress, type ServerAddressOptions } from "./server-address";
import { installShutdownHandlers } from "./server-lifecycle";

export { resolveServerAddress } from "./server-address";

const app = new Hono();
const agentDir = getZuuAgentDir();
export const audit = new AuditService(getAuditEventStorePath(agentDir));
export const auth = new AuthService(getAuthTokenStorePath(agentDir));
const daemon = createDaemonServiceRegistry({ audit });
const webDistRoot = "./web/dist";
const webIndex = new URL("../web/dist/index.html", import.meta.url);
const hasWebDist = existsSync(webIndex);

app.use("/v1/*", createAuthMiddleware(auth));
app.use("/v1/*", createAuditMiddleware(audit, { resolveAuthContext: (authorization) => auth.contextForAuthorization(authorization) }));

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

export function startServer(options: number | ServerAddressOptions = {}) {
  const address = resolveServerAddress(typeof options === "number" ? { port: options } : options);
  const server = serve({ fetch: app.fetch, port: address.port, hostname: address.hostname });
  console.log(`Zuu Agent listening on ${address.url}`);
  if (!address.loopback) {
    console.warn(`Zuu Agent is listening on non-loopback host ${address.hostname}. Keep Bearer tokens private and expose this only behind a trusted boundary.`);
  }
  console.log(auth.startupMessage());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = startServer();
  installShutdownHandlers(server, daemon);
}

export default app;
