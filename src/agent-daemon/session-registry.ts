import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { notFound } from "../http";
import { bindManagedRuntime, type ManagedRuntime } from "./session-runtime";
import type { SessionSummaryContext } from "./session-summary";

export class SessionRuntimeRegistry {
  private readonly runtimes = new Map<string, ManagedRuntime>();

  get size() {
    return this.runtimes.size;
  }

  list(projectId?: string) {
    return [...this.runtimes.values()].filter((managed) => !projectId || managed.projectId === projectId);
  }

  get(sessionId: string) {
    const managed = this.runtimes.get(sessionId);
    if (!managed) notFound(`Unknown session: ${sessionId}`, { sessionId });
    return managed;
  }

  findBySessionFile(sessionFile: string) {
    return this.list().find((managed) => managed.runtime.session.sessionFile === sessionFile);
  }

  add(managed: ManagedRuntime) {
    bindManagedRuntime(this.runtimes, managed);
    this.runtimes.set(managed.runtime.session.sessionId, managed);
  }

  delete(managed: ManagedRuntime) {
    for (const [sessionId, item] of this.runtimes) {
      if (item === managed) this.runtimes.delete(sessionId);
    }
  }

  isSessionFileActive(sessionFile: string) {
    return this.list().some((managed) => managed.runtime.session.sessionFile === sessionFile);
  }

  touch(sessionId: string) {
    this.get(sessionId).updatedAt = new Date().toISOString();
  }

  async dispose() {
    for (const managed of this.runtimes.values()) {
      await managed.runtime.dispose();
    }
    this.runtimes.clear();
  }

  summaryContext(session: AgentSession, fallback: { projectId: string; cwd: string }): SessionSummaryContext {
    const managed = this.runtimes.get(session.sessionId);
    const now = new Date().toISOString();
    return {
      projectId: managed?.projectId ?? fallback.projectId,
      cwd: managed?.cwd ?? fallback.cwd,
      createdAt: managed?.createdAt ?? now,
      updatedAt: managed?.updatedAt ?? now,
    };
  }
}
