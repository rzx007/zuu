import type { ModelSmokeRequest, PromptRequest } from "@zuu/client";
import { assertObject, optionalBoolean, optionalString, optionalStringArray, requireString, validationError } from "../server";
import { parseModel, parseThinkingLevel } from "./request-validation-common";

const RUN_SOURCES = new Set(["user", "schedule", "workflow", "api"]);
const STREAMING_BEHAVIORS = new Set(["steer", "followUp"]);

export function parsePrompt(value: unknown): PromptRequest {
  assertObject(value);
  const source = optionalString(value.source, "source");
  if (source !== undefined && !RUN_SOURCES.has(source)) {
    validationError("source must be user, schedule, workflow, or api", { field: "source" });
  }
  const streamingBehavior = optionalString(value.streamingBehavior, "streamingBehavior");
  if (streamingBehavior !== undefined && !STREAMING_BEHAVIORS.has(streamingBehavior)) {
    validationError("streamingBehavior must be steer or followUp", { field: "streamingBehavior" });
  }
  return {
    prompt: requireString(value.prompt, "prompt"),
    sessionId: optionalString(value.sessionId, "sessionId"),
    projectId: optionalString(value.projectId, "projectId"),
    source: source as PromptRequest["source"],
    streamingBehavior: streamingBehavior as PromptRequest["streamingBehavior"],
    name: optionalString(value.name, "name"),
    cwd: optionalString(value.cwd, "cwd"),
    sessionFile: optionalString(value.sessionFile, "sessionFile"),
    continueRecent: optionalBoolean(value.continueRecent, "continueRecent"),
    model: parseModel(value.model),
    thinkingLevel: parseThinkingLevel(value.thinkingLevel),
    tools: optionalStringArray(value.tools, "tools"),
    persist: optionalBoolean(value.persist, "persist"),
  };
}

export function parseModelSmoke(value: unknown): ModelSmokeRequest {
  assertObject(value);
  const timeoutMs = value.timeoutMs;
  if (
    timeoutMs !== undefined &&
    (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000)
  ) {
    validationError("timeoutMs must be an integer from 1000 to 120000", { field: "timeoutMs" });
  }
  return {
    model: parseModel(value.model),
    projectId: optionalString(value.projectId, "projectId"),
    prompt: optionalString(value.prompt, "prompt"),
    thinkingLevel: parseThinkingLevel(value.thinkingLevel),
    timeoutMs,
  };
}
