import type {
  CreateScheduleRequest,
  ForkSessionRequest,
  ImportSessionRequest,
  NewSessionRequest,
  OpenSessionRequest,
  PackageMutationRequest,
  PromptRequest,
  ResolveApprovalRequest,
  ScheduleAction,
  ScheduleTrigger,
  StartWorkflowRequest,
  SwitchSessionRequest,
  ThinkingLevel,
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

const APPROVAL_DECISIONS = new Set(["allow_once", "allow_session", "deny"]);
const FORK_POSITIONS = new Set(["before", "at"]);
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export function parsePackageMutation(value: unknown): PackageMutationRequest {
  assertObject(value);
  return { source: requireString(value.source, "source") };
}

export function parseCreateSession(value: unknown): Record<string, unknown> {
  assertObject(value);
  optionalString(value.cwd, "cwd");
  optionalString(value.name, "name");
  optionalString(value.sessionFile, "sessionFile");
  optionalBoolean(value.persist, "persist");
  return value;
}

export function parseOpenSession(value: unknown): OpenSessionRequest {
  assertObject(value);
  return {
    sessionFile: requireString(value.sessionFile, "sessionFile"),
    cwdOverride: optionalString(value.cwdOverride, "cwdOverride"),
    name: optionalString(value.name, "name"),
    model: parseModel(value.model),
    thinkingLevel: parseThinkingLevel(value.thinkingLevel),
    tools: optionalStringArray(value.tools, "tools"),
  };
}

export function parsePrompt(value: unknown): PromptRequest {
  assertObject(value);
  return {
    prompt: requireString(value.prompt, "prompt"),
    sessionId: optionalString(value.sessionId, "sessionId"),
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

export function parseStartWorkflow(value: unknown): StartWorkflowRequest {
  assertObject(value);
  const source = optionalString(value.source, "source");
  if (source !== undefined && source !== "user" && source !== "schedule" && source !== "api") {
    validationError("source must be user, schedule, or api", { field: "source" });
  }
  return {
    sessionId: optionalString(value.sessionId, "sessionId"),
    prompt: optionalString(value.prompt, "prompt"),
    inputs: optionalRecord(value.inputs, "inputs"),
    source,
  };
}

export function parseCreateSchedule(value: unknown): CreateScheduleRequest {
  assertObject(value);
  return {
    name: optionalString(value.name, "name"),
    trigger: parseScheduleTrigger(value.trigger),
    action: parseScheduleAction(value.action),
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

function parseModel(value: unknown): PromptRequest["model"] {
  if (value === undefined) return undefined;
  assertObject(value, "model");
  return {
    provider: requireString(value.provider, "model.provider"),
    id: requireString(value.id, "model.id"),
  };
}

function parseThinkingLevel(value: unknown): ThinkingLevel | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !THINKING_LEVELS.has(value)) {
    validationError("thinkingLevel is invalid", { field: "thinkingLevel" });
  }
  return value as ThinkingLevel;
}

function parseScheduleTrigger(value: unknown): ScheduleTrigger {
  assertObject(value, "trigger");
  const kind = requireString(value.kind, "trigger.kind");
  if (kind === "once") {
    return { kind, runAt: requireString(value.runAt, "trigger.runAt") };
  }
  if (kind === "interval") {
    if (typeof value.everyMs !== "number" || !Number.isFinite(value.everyMs)) {
      validationError("trigger.everyMs must be a number", { field: "trigger.everyMs" });
    }
    return { kind, everyMs: value.everyMs };
  }
  if (kind === "cron") {
    return {
      kind,
      cron: requireString(value.cron, "trigger.cron"),
      timezone: optionalString(value.timezone, "trigger.timezone"),
    };
  }
  validationError("trigger.kind must be once, interval, or cron", { field: "trigger.kind" });
}

function parseScheduleAction(value: unknown): ScheduleAction {
  assertObject(value, "action");
  const type = requireString(value.type, "action.type");
  if (type === "prompt") {
    return {
      type,
      prompt: requireString(value.prompt, "action.prompt"),
      sessionId: optionalString(value.sessionId, "action.sessionId"),
      name: optionalString(value.name, "action.name"),
      model: parseModel(value.model),
      thinkingLevel: parseThinkingLevel(value.thinkingLevel),
      tools: optionalStringArray(value.tools, "action.tools"),
      persist: optionalBoolean(value.persist, "action.persist"),
    };
  }
  if (type === "workflow") {
    return {
      type,
      workflowId: requireString(value.workflowId, "action.workflowId"),
      prompt: optionalString(value.prompt, "action.prompt"),
      sessionId: optionalString(value.sessionId, "action.sessionId"),
      inputs: optionalRecord(value.inputs, "action.inputs"),
    };
  }
  validationError("action.type must be prompt or workflow", { field: "action.type" });
}
