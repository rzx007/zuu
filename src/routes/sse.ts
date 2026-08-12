import type { PromptStreamEvent } from "@zuu/client";
import { streamSSE } from "hono/streaming";

export type PromptStream = Parameters<Parameters<typeof streamSSE>[1]>[0];

export function writePromptStreamEvent(stream: PromptStream, event: PromptStreamEvent) {
  return stream.writeSSE({
    id: event.id,
    event: event.type,
    data: JSON.stringify(event),
  });
}
