import { ApiError, validationError } from "../http";
import { assertAllowedPath } from "./environment";
import type { ManagedRuntime } from "./session-runtime";

export function assertSessionIdle(managed: ManagedRuntime, sessionId: string, action: "compact" | "delete") {
  if (!managed.runtime.session.isStreaming) return;
  const verb = action === "delete" ? "deleting" : "compacting";
  throw new ApiError(`Session is running; abort it before ${verb}`, {
    status: 409,
    code: "session_busy",
    details: { sessionId },
  });
}

export function requireSessionPath(path: unknown, field: "path" | "sessionFile") {
  if (!path || typeof path !== "string") {
    validationError(`${field} is required`, { field });
  }
  assertAllowedPath(path, field);
  return path;
}

export function assertOptionalCwdOverride(cwdOverride: string | undefined) {
  if (cwdOverride) assertAllowedPath(cwdOverride, "cwdOverride");
}

export function requireEntryId(entryId: unknown) {
  if (!entryId || typeof entryId !== "string") {
    validationError("entryId is required", { field: "entryId" });
  }
  return entryId;
}
