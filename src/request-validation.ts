import type {
  CreateProjectRequest,
  CreateScheduleRequest,
  CreateSessionRequest,
  ForkSessionRequest,
  ImportSessionRequest,
  NewSessionRequest,
  OpenSessionRequest,
  PackageMutationRequest,
  ModelSmokeRequest,
  PromptRequest,
  ResolveApprovalRequest,
  ScheduleAction,
  ScheduleRetryPolicy,
  ScheduleTrigger,
  StartWorkflowRequest,
  SwitchSessionRequest,
  ThinkingLevel,
  UpdateProjectRequest,
  UpdateScheduleRequest,
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

const APPROVAL_DECISIONS = new Set(["allow_once", "allow_session", "deny"]);
const FORK_POSITIONS = new Set(["before", "at"]);
const RUN_SOURCES = new Set(["user", "schedule", "workflow", "api"]);
const SCHEDULE_OVERLAP_POLICIES = new Set(["skip", "queue", "parallel"]);
const SCHEDULE_MISFIRE_POLICIES = new Set(["skip", "run_once"]);
const STREAMING_BEHAVIORS = new Set(["steer", "followUp"]);
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const MIN_SCHEDULE_INTERVAL_MS = 1_000;

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

export function parseCreateSchedule(value: unknown): CreateScheduleRequest {
  assertObject(value);
  return {
    name: optionalString(value.name, "name"),
    trigger: parseScheduleTrigger(value.trigger),
    action: parseScheduleAction(value.action),
    ...parseSchedulePolicies(value),
    retryPolicy: parseScheduleRetryPolicy(value.retryPolicy),
  };
}

export function parseUpdateSchedule(value: unknown): UpdateScheduleRequest {
  assertObject(value);
  return {
    name: optionalString(value.name, "name"),
    trigger: value.trigger === undefined ? undefined : parseScheduleTrigger(value.trigger),
    action: value.action === undefined ? undefined : parseScheduleAction(value.action),
    ...parseSchedulePolicies(value),
    retryPolicy: value.retryPolicy === null ? null : parseScheduleRetryPolicy(value.retryPolicy),
  };
}

function parseSchedulePolicies(value: Record<string, unknown>) {
  const overlapPolicy = optionalString(value.overlapPolicy, "overlapPolicy");
  if (overlapPolicy !== undefined && !SCHEDULE_OVERLAP_POLICIES.has(overlapPolicy)) {
    validationError("overlapPolicy must be skip, queue, or parallel", { field: "overlapPolicy" });
  }
  const misfirePolicy = optionalString(value.misfirePolicy, "misfirePolicy");
  if (misfirePolicy !== undefined && !SCHEDULE_MISFIRE_POLICIES.has(misfirePolicy)) {
    validationError("misfirePolicy must be skip or run_once", { field: "misfirePolicy" });
  }
  return {
    overlapPolicy: overlapPolicy as CreateScheduleRequest["overlapPolicy"],
    misfirePolicy: misfirePolicy as CreateScheduleRequest["misfirePolicy"],
  };
}

function parseScheduleRetryPolicy(value: unknown): ScheduleRetryPolicy | undefined {
  if (value === undefined) return undefined;
  assertObject(value, "retryPolicy");
  if (typeof value.maxAttempts !== "number" || !Number.isInteger(value.maxAttempts) || value.maxAttempts < 1 || value.maxAttempts > 5) {
    validationError("retryPolicy.maxAttempts must be an integer from 1 to 5", { field: "retryPolicy.maxAttempts" });
  }
  if (typeof value.backoffMs !== "number" || !Number.isFinite(value.backoffMs) || value.backoffMs < 0 || value.backoffMs > 60_000) {
    validationError("retryPolicy.backoffMs must be between 0 and 60000", { field: "retryPolicy.backoffMs" });
  }
  return {
    maxAttempts: value.maxAttempts,
    backoffMs: value.backoffMs,
    retryableCodes: optionalStringArray(value.retryableCodes, "retryPolicy.retryableCodes"),
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
    const runAt = requireString(value.runAt, "trigger.runAt");
    if (Number.isNaN(Date.parse(runAt))) {
      validationError("trigger.runAt must be an ISO date string", { field: "trigger.runAt" });
    }
    return { kind, runAt };
  }
  if (kind === "interval") {
    if (
      typeof value.everyMs !== "number" ||
      !Number.isFinite(value.everyMs) ||
      value.everyMs < MIN_SCHEDULE_INTERVAL_MS
    ) {
      validationError(`trigger.everyMs must be at least ${MIN_SCHEDULE_INTERVAL_MS}`, { field: "trigger.everyMs" });
    }
    return { kind, everyMs: value.everyMs };
  }
  if (kind === "cron") {
    const timezone = requireString(value.timezone, "trigger.timezone");
    validateTimeZone(timezone);
    return {
      kind,
      cron: requireString(value.cron, "trigger.cron"),
      timezone,
    };
  }
  validationError("trigger.kind must be once, interval, or cron", { field: "trigger.kind" });
}

function validateTimeZone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    validationError("trigger.timezone must be a valid IANA timezone", { field: "trigger.timezone" });
  }
}

function parseScheduleAction(value: unknown): ScheduleAction {
  assertObject(value, "action");
  const type = requireString(value.type, "action.type");
  if (type === "prompt") {
    return {
      type,
      prompt: requireString(value.prompt, "action.prompt"),
      projectId: optionalString(value.projectId, "action.projectId"),
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
      projectId: optionalString(value.projectId, "action.projectId"),
      sessionId: optionalString(value.sessionId, "action.sessionId"),
      inputs: optionalRecord(value.inputs, "action.inputs"),
    };
  }
  validationError("action.type must be prompt or workflow", { field: "action.type" });
}
