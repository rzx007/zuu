import type { ServerType } from "@hono/node-server";
import type { DaemonServiceRegistry } from "./agent-daemon/daemon-service-registry";

export function installShutdownHandlers(server: ServerType, daemon: Pick<DaemonServiceRegistry, "dispose">) {
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

function closeServer(server: ServerType) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
