import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HealthResponse } from "@zuu/client";

const PROTOCOL_VERSION = "v1";
const STARTED_AT_MS = Date.now();
const STARTED_AT = new Date(STARTED_AT_MS).toISOString();

export function buildHealth(): HealthResponse {
  return {
    ok: true,
    status: "ready",
    protocolVersion: PROTOCOL_VERSION,
    version: packageVersion(),
    startedAt: STARTED_AT,
    uptimeMs: Math.max(0, Date.now() - STARTED_AT_MS),
    node: process.version,
    platform: process.platform,
  };
}

function packageVersion() {
  try {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version?: string };
    return packageJson.version ?? "0.0.0-dev";
  } catch {
    return "0.0.0-dev";
  }
}
