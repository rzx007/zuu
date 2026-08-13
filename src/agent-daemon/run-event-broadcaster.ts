import type { EventStreamQuery, PromptStreamEvent } from "@zuu/client";
import { matchesEventQuery } from "./run-event-query";

type EventListener = (event: PromptStreamEvent) => void;

export class RunEventBroadcaster {
  private readonly eventListeners = new Set<EventListener>();

  subscribe(query: EventStreamQuery, listener: EventListener) {
    const filteredListener = (event: PromptStreamEvent) => {
      if (matchesEventQuery(event, query)) listener(event);
    };
    this.eventListeners.add(filteredListener);
    return () => this.eventListeners.delete(filteredListener);
  }

  publish(event: PromptStreamEvent) {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  clear() {
    this.eventListeners.clear();
  }
}
