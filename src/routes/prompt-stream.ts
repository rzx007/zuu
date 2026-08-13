import type { PromptRequest, PromptStreamEvent } from "@zuu/client";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { DaemonServiceRegistry } from "../agent-daemon/daemon-service-registry";
import { jsonError, toStatus } from "../http";
import { writePromptStreamEvent } from "./sse";

export async function streamPromptResponse(c: Context, daemon: DaemonServiceRegistry, request: PromptRequest) {
  const events = daemon.core.promptService.prompt(request);
  let first: IteratorResult<PromptStreamEvent>;
  try {
    first = await events.next();
  } catch (error) {
    return c.json(jsonError(error, 400), toStatus(error, 400));
  }

  return streamSSE(c, async (stream) => {
    try {
      if (!first.done && !stream.aborted) {
        await writePromptStreamEvent(stream, first.value);
      }
      for await (const event of events) {
        if (stream.aborted) break;
        await writePromptStreamEvent(stream, event);
      }
    } catch (error) {
      await writePromptStreamEvent(stream, createPromptErrorEvent(error));
    }
  });
}

function createPromptErrorEvent(error: unknown): PromptStreamEvent {
  return {
    id: `unknown:${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
    runId: "unknown",
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  };
}
