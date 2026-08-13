import type {
  CreateSessionRequest,
  ForkSessionRequest,
  ImportSessionRequest,
  NewSessionRequest,
  OpenSessionRequest,
  SwitchSessionRequest,
  UpdateSessionRequest,
} from "@zuu/client";
import { assertObject, optionalBoolean, optionalString, optionalStringArray, requireString, validationError } from "../server";
import { parseModel, parseThinkingLevel } from "./request-validation-common";

const FORK_POSITIONS = new Set(["before", "at"]);

export function parseCreateSession(value: unknown): CreateSessionRequest {
  assertObject(value);
  return {
    projectId: optionalString(value.projectId, "projectId"),
    cwd: optionalString(value.cwd, "cwd"),
    name: optionalString(value.name, "name"),
    sessionFile: optionalString(value.sessionFile, "sessionFile"),
    continueRecent: optionalBoolean(value.continueRecent, "continueRecent"),
    model: parseModel(value.model),
    thinkingLevel: parseThinkingLevel(value.thinkingLevel),
    tools: optionalStringArray(value.tools, "tools"),
    persist: optionalBoolean(value.persist, "persist"),
  };
}

export function parseOpenSession(value: unknown): OpenSessionRequest {
  assertObject(value);
  return {
    sessionFile: requireString(value.sessionFile, "sessionFile"),
    projectId: optionalString(value.projectId, "projectId"),
    cwdOverride: optionalString(value.cwdOverride, "cwdOverride"),
    name: optionalString(value.name, "name"),
    model: parseModel(value.model),
    thinkingLevel: parseThinkingLevel(value.thinkingLevel),
    tools: optionalStringArray(value.tools, "tools"),
  };
}

export function parseUpdateSession(value: unknown): UpdateSessionRequest {
  assertObject(value);
  return {
    name: optionalString(value.name, "name"),
    tools: optionalStringArray(value.tools, "tools"),
  };
}

export function parseCompact(value: unknown): { instructions?: string } {
  assertObject(value);
  return { instructions: optionalString(value.instructions, "instructions") };
}

export function parseNewSession(value: unknown): NewSessionRequest {
  assertObject(value);
  return {
    name: optionalString(value.name, "name"),
    parentSession: optionalString(value.parentSession, "parentSession"),
  };
}

export function parseSwitchSession(value: unknown): SwitchSessionRequest {
  assertObject(value);
  return {
    sessionFile: requireString(value.sessionFile, "sessionFile"),
    cwdOverride: optionalString(value.cwdOverride, "cwdOverride"),
  };
}

export function parseForkSession(value: unknown): ForkSessionRequest {
  assertObject(value);
  const position = optionalString(value.position, "position");
  if (position !== undefined && !FORK_POSITIONS.has(position)) {
    validationError("position must be before or at", { field: "position" });
  }
  return {
    entryId: requireString(value.entryId, "entryId"),
    position: position as ForkSessionRequest["position"],
  };
}

export function parseImportSession(value: unknown): ImportSessionRequest {
  assertObject(value);
  return {
    path: requireString(value.path, "path"),
    cwdOverride: optionalString(value.cwdOverride, "cwdOverride"),
  };
}
