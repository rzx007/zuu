import type { PromptRequest, ThinkingLevel } from "@zuu/client";
import { assertObject, requireString, validationError } from "./http";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export function parseModel(value: unknown): PromptRequest["model"] {
  if (value === undefined) return undefined;
  assertObject(value, "model");
  return {
    provider: requireString(value.provider, "model.provider"),
    id: requireString(value.id, "model.id"),
  };
}

export function parseThinkingLevel(value: unknown): ThinkingLevel | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !THINKING_LEVELS.has(value)) {
    validationError("thinkingLevel is invalid", { field: "thinkingLevel" });
  }
  return value as ThinkingLevel;
}
