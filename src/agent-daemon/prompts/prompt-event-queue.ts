import type { RunEventDraft } from "../runs/run-events";

export class PromptEventQueue {
  private readonly queue: RunEventDraft[] = [];
  private notify: (() => void) | undefined;
  private finished = false;
  private finishedError: unknown;

  get error() {
    return this.finishedError;
  }

  push(event: RunEventDraft) {
    this.queue.push(event);
    this.wake();
  }

  finish(error?: unknown) {
    this.finished = true;
    this.finishedError = error;
    this.wake();
  }

  async next() {
    for (;;) {
      const event = this.queue.shift();
      if (event) return event;
      if (this.finished) return undefined;
      await new Promise<void>((resolve) => {
        this.notify = resolve;
      });
    }
  }

  private wake() {
    this.notify?.();
    this.notify = undefined;
  }
}
