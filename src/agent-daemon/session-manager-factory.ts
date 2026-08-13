import { SessionManager } from "@earendil-works/pi-coding-agent";
import { assertAllowedPath } from "./environment";
import type { CreateSessionOptions } from "./session-runtime";

export function createManagedSessionManager(options: CreateSessionOptions, cwd: string, sessionDir: string) {
  assertAllowedPath(cwd, "cwd");
  if (options.sessionFile) {
    assertAllowedPath(options.sessionFile, "sessionFile");
    return SessionManager.open(options.sessionFile, sessionDir, cwd);
  }

  if (options.continueRecent) {
    return SessionManager.continueRecent(cwd, sessionDir);
  }

  return options.persist === false ? SessionManager.inMemory(cwd) : SessionManager.create(cwd, sessionDir);
}
