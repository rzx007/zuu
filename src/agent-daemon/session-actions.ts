import type {
  ForkSessionRequest,
  ImportSessionRequest,
  NewSessionRequest,
  SessionSummary,
  SwitchSessionRequest,
  UpdateSessionRequest,
} from "@zuu/client";
import { assertOptionalCwdOverride, requireEntryId, requireSessionPath } from "./session-action-validation";
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
  const sessionFile = requireSessionPath(options.sessionFile, "sessionFile");
  assertOptionalCwdOverride(options.cwdOverride);
  const result = await managed.runtime.switchSession(sessionFile, { cwdOverride: options.cwdOverride });
  return summarizeRuntimeAction(managed, result, summarize);
}

export async function forkManagedSession(
  managed: ManagedRuntime,
  options: ForkSessionRequest,
  summarize: SummarizeManagedSession,
) {
  const entryId = requireEntryId(options.entryId);
  const result = await managed.runtime.fork(entryId, { position: options.position });
  return summarizeRuntimeAction(managed, result, summarize);
}

export async function importManagedSession(
  managed: ManagedRuntime,
  options: ImportSessionRequest,
  summarize: SummarizeManagedSession,
) {
  const path = requireSessionPath(options.path, "path");
  assertOptionalCwdOverride(options.cwdOverride);
  const result = await managed.runtime.importFromJsonl(path, options.cwdOverride);
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
