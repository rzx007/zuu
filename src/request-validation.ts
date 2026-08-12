import type {
  CreateProjectRequest,
  CreateSessionRequest,
  ForkSessionRequest,
  ImportSessionRequest,
  NewSessionRequest,
  OpenSessionRequest,
  PackageMutationRequest,
  ModelSmokeRequest,
  PromptRequest,
  ResolveApprovalRequest,
  StartWorkflowRequest,
  SwitchSessionRequest,
  UpdateProjectRequest,
  UpdateSessionRequest,
} from "@zuu/client";
import {
  assertObject,
  optionalBoolean,
  optionalRecord,
  optionalString,
  optionalStringArray,
  requireString,
  validationError,
} from "./http";
import { parseModel, parseThinkingLevel } from "./request-validation-common";

const APPROVAL_DECISIONS = new Set(["allow_once", "allow_session", "deny"]);
const FORK_POSITIONS = new Set(["before", "at"]);
const RUN_SOURCES = new Set(["user", "schedule", "workflow", "api"]);
const STREAMING_BEHAVIORS = new Set(["steer", "followUp"]);

export function parsePackageMutation(value: unknown): PackageMutationRequest {
  assertObject(value);
  return { source: requireString(value.source, "source") };
}

export function parseCreateProject(value: unknown): CreateProjectRequest {
  assertObject(value);
  return {
    name: optionalString(value.name, "name"),
    cwd: requireString(value.cwd, "cwd"),
  };
}

export function parseUpdateProject(value: unknown): UpdateProjectRequest {
  assertObject(value);
  return {
    name: optionalString(value.name, "name"),
    cwd: optionalString(value.cwd, "cwd"),
  };
}

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

export function parseStartWorkflow(value: unknown): StartWorkflowRequest {
  assertObject(value);
  const source = optionalString(value.source, "source");
  if (source !== undefined && source !== "user" && source !== "schedule" && source !== "api") {
    validationError("source must be user, schedule, or api", { field: "source" });
  }
  return {
    projectId: optionalString(value.projectId, "projectId"),
    sessionId: optionalString(value.sessionId, "sessionId"),
    prompt: optionalString(value.prompt, "prompt"),
    inputs: optionalRecord(value.inputs, "inputs"),
    source,
  };
}

export function parseResolveApproval(value: unknown): ResolveApprovalRequest {
  assertObject(value);
  if (!APPROVAL_DECISIONS.has(String(value.decision))) {
    validationError("decision must be allow_once, allow_session, or deny", { field: "decision" });
  }
  return { decision: value.decision as ResolveApprovalRequest["decision"] };
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
