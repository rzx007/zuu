import type {
  ForkSessionRequest,
  ImportSessionRequest,
  NewSessionRequest,
  SessionSummary,
  SwitchSessionRequest,
  UpdateSessionRequest,
} from "@zuu/client";
import { ApiError, validationError } from "../http";
import { assertAllowedPath } from "./environment";
import type { ManagedRuntime } from "./session-runtime";
import { summarizeSessionAction } from "./session-summary";

type SummarizeManagedSession = (managed: ManagedRuntime) => SessionSummary;

export function applySessionUpdate(managed: ManagedRuntime, request: UpdateSessionRequest) {
  if (request.name !== undefined) {
    const name = request.name.trim();
    if (name) managed.runtime.session.setSessionName(name);
  }
  if (request.tools !== undefined) {
    managed.runtime.session.setActiveToolsByName(request.tools);
  }
  managed.updatedAt = new Date().toISOString();
}

export function assertSessionIdle(managed: ManagedRuntime, sessionId: string, action: "compact" | "delete") {
  if (!managed.runtime.session.isStreaming) return;
  const verb = action === "delete" ? "deleting" : "compacting";
  throw new ApiError(`Session is running; abort it before ${verb}`, {
    status: 409,
    code: "session_busy",
    details: { sessionId },
  });
}

export async function newManagedSession(
  managed: ManagedRuntime,
  options: NewSessionRequest,
  summarize: SummarizeManagedSession,
) {
  const result = await managed.runtime.newSession({ parentSession: options.parentSession });
  if (!result.cancelled && options.name) {
    managed.runtime.session.setSessionName(options.name);
  }
  return summarizeRuntimeAction(managed, result, summarize);
}

export async function switchManagedSession(
  managed: ManagedRuntime,
  options: SwitchSessionRequest,
  summarize: SummarizeManagedSession,
) {
  if (!options.sessionFile || typeof options.sessionFile !== "string") {
    validationError("sessionFile is required", { field: "sessionFile" });
  }

  if (options.cwdOverride) assertAllowedPath(options.cwdOverride, "cwdOverride");
  assertAllowedPath(options.sessionFile, "sessionFile");
  const result = await managed.runtime.switchSession(options.sessionFile, { cwdOverride: options.cwdOverride });
  return summarizeRuntimeAction(managed, result, summarize);
}

export async function forkManagedSession(
  managed: ManagedRuntime,
  options: ForkSessionRequest,
  summarize: SummarizeManagedSession,
) {
  if (!options.entryId || typeof options.entryId !== "string") {
    validationError("entryId is required", { field: "entryId" });
  }

  const result = await managed.runtime.fork(options.entryId, { position: options.position });
  return summarizeRuntimeAction(managed, result, summarize);
}

export async function importManagedSession(
  managed: ManagedRuntime,
  options: ImportSessionRequest,
  summarize: SummarizeManagedSession,
) {
  if (!options.path || typeof options.path !== "string") {
    validationError("path is required", { field: "path" });
  }

  assertAllowedPath(options.path, "path");
  if (options.cwdOverride) assertAllowedPath(options.cwdOverride, "cwdOverride");
  const result = await managed.runtime.importFromJsonl(options.path, options.cwdOverride);
  return summarizeRuntimeAction(managed, result, summarize);
}

function summarizeRuntimeAction(
  managed: ManagedRuntime,
  result: { cancelled: boolean; selectedText?: string },
  summarize: SummarizeManagedSession,
) {
  managed.cwd = managed.runtime.cwd;
  managed.updatedAt = new Date().toISOString();
  return summarizeSessionAction(summarize(managed), result);
}
