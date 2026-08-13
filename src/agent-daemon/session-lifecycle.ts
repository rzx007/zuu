import type { SessionSummary } from "@zuu/client";
import { assertSessionIdle } from "./session-actions";
import type { ManagedRuntime } from "./session-runtime";

type SummarizeManagedSession = (managed: ManagedRuntime) => SessionSummary;

export async function deleteManagedSession(
  managed: ManagedRuntime,
  sessionId: string,
  summarize: SummarizeManagedSession,
  remove: (managed: ManagedRuntime) => void,
) {
  assertSessionIdle(managed, sessionId, "delete");
  const session = summarize(managed);
  await managed.runtime.dispose();
  remove(managed);
  return session;
}

export async function abortManagedSession(managed: ManagedRuntime, summarize: SummarizeManagedSession) {
  await managed.runtime.session.abort();
  managed.updatedAt = new Date().toISOString();
  return summarize(managed);
}

export async function compactManagedSession(
  managed: ManagedRuntime,
  sessionId: string,
  instructions: string | undefined,
  summarize: SummarizeManagedSession,
) {
  assertSessionIdle(managed, sessionId, "compact");
  await managed.runtime.session.compact(instructions);
  managed.updatedAt = new Date().toISOString();
  return summarize(managed);
}
