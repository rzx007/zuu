import { createZuuClient, type ModelSmokeRequest } from "@zuu/client";
import { scriptAdminApiToken } from "./local-auth";
import { envEnum, envPositiveInteger, envString } from "./script-env";

const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly NonNullable<ModelSmokeRequest["thinkingLevel"]>[];

function fail(message: string): never {
  throw new Error(message);
}

function optionalModel(): ModelSmokeRequest["model"] {
  const provider = envString("ZUU_MODEL_PROVIDER");
  const id = envString("ZUU_MODEL_ID");
  if (!provider && !id) return undefined;
  if (!provider || !id) fail("ZUU_MODEL_PROVIDER and ZUU_MODEL_ID must be set together.");
  return { provider, id };
}

function optionalTimeoutMs() {
  return envPositiveInteger("ZUU_MODEL_TIMEOUT_MS");
}

function optionalThinkingLevel() {
  return envEnum("ZUU_MODEL_THINKING_LEVEL", THINKING_LEVELS);
}

async function main() {
  const apiToken = scriptAdminApiToken();
  if (!apiToken) fail("ZUU_API_TOKEN is not set and no active local admin token was found.");

  const baseUrl = envString("ZUU_BASE_URL", "http://127.0.0.1:3001");
  const client = createZuuClient({ baseUrl, apiToken });
  const health = await client.health();
  if (!health.ok) fail(`Zuu daemon is not healthy at ${baseUrl}`);

  const result = await client.smokeModel({
    model: optionalModel(),
    projectId: envString("ZUU_MODEL_PROJECT_ID"),
    prompt: envString("ZUU_MODEL_PROMPT", "只回复 zuu-ok"),
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
