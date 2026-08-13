import { createZuuClient, type ModelSmokeRequest } from "@zuu/client";
import { scriptAdminApiToken } from "./local-auth";

const baseUrl = process.env.ZUU_BASE_URL ?? "http://127.0.0.1:3001";
const THINKING_LEVELS = new Set<ModelSmokeRequest["thinkingLevel"]>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function fail(message: string): never {
  throw new Error(message);
}

function optionalModel(): ModelSmokeRequest["model"] {
  const provider = process.env.ZUU_MODEL_PROVIDER?.trim();
  const id = process.env.ZUU_MODEL_ID?.trim();
  if (!provider && !id) return undefined;
  if (!provider || !id) fail("ZUU_MODEL_PROVIDER and ZUU_MODEL_ID must be set together.");
  return { provider, id };
}

function optionalTimeoutMs() {
  const raw = process.env.ZUU_MODEL_TIMEOUT_MS?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) fail("ZUU_MODEL_TIMEOUT_MS must be a positive integer.");
  return value;
}

function optionalThinkingLevel() {
  const raw = process.env.ZUU_MODEL_THINKING_LEVEL?.trim();
  if (!raw) return undefined;
  if (!THINKING_LEVELS.has(raw as ModelSmokeRequest["thinkingLevel"])) {
    fail("ZUU_MODEL_THINKING_LEVEL must be one of off, minimal, low, medium, high, xhigh, or max.");
  }
  return raw as ModelSmokeRequest["thinkingLevel"];
}

async function main() {
  const apiToken = scriptAdminApiToken();
  if (!apiToken) fail("ZUU_API_TOKEN is not set and no active local admin token was found.");

  const client = createZuuClient({ baseUrl, apiToken });
  const health = await client.health();
  if (!health.ok) fail(`Zuu daemon is not healthy at ${baseUrl}`);

  const result = await client.smokeModel({
    model: optionalModel(),
    projectId: process.env.ZUU_MODEL_PROJECT_ID,
    prompt: process.env.ZUU_MODEL_PROMPT ?? "只回复 zuu-ok",
    thinkingLevel: optionalThinkingLevel(),
    timeoutMs: optionalTimeoutMs(),
  });

  const summary = {
    ok: result.ok,
    status: result.status,
    model: result.model,
    runId: result.runId,
    sessionId: result.sessionId,
    durationMs: result.durationMs,
    eventCount: result.eventCount,
    textPreview: result.textPreview,
    error: result.error,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
