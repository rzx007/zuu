import type {
  EventStreamQuery,
  PromptRequest,
  PromptStreamEvent,
} from "./protocol.js";
import { joinUrl, parseJsonResponse, withQuery, ZuuClientError } from "./http.js";

export interface PromptStreamOptions {
  signal?: AbortSignal;
}

export interface EventStreamOptions extends EventStreamQuery {
  signal?: AbortSignal;
  reconnect?: boolean;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  onOpen?: () => void;
  onReconnect?: (attempt: number, afterEventId: string | undefined) => void;
}

const PROMPT_STREAM_EVENT_TYPES = new Set<PromptStreamEvent["type"]>([
  "session",
  "text_delta",
  "tool_start",
  "tool_update",
  "tool_end",
  "agent_event",
  "approval_requested",
  "approval_resolved",
  "done",
  "error",
]);

export async function* streamPrompt(
  fetchImpl: typeof fetch,
  baseUrl: string,
  apiToken: string | undefined,
  path: string,
  input: PromptRequest | Omit<PromptRequest, "sessionId" | "streamingBehavior">,
  options: PromptStreamOptions,
): AsyncGenerator<PromptStreamEvent> {
  const response = await fetchImpl(joinUrl(baseUrl, path), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}),
    },
    body: JSON.stringify(input),
    signal: options.signal,
  });

  if (!response.ok || !response.body) {
    await parseJsonResponse(response);
    return;
  }

  yield* readPromptStream(response);
}

export async function* streamEvents(
  fetchImpl: typeof fetch,
  baseUrl: string,
  apiToken: string | undefined,
  options: EventStreamOptions,
): AsyncGenerator<PromptStreamEvent> {
  const reconnect = options.reconnect ?? true;
  const reconnectDelayMs = options.reconnectDelayMs ?? 500;
  const maxReconnectDelayMs = options.maxReconnectDelayMs ?? 5_000;
  const seenEventIds = new Set<string>();
  const seenEventOrder: string[] = [];
  let afterEventId = options.afterEventId;
  let attempt = 0;

  while (!options.signal?.aborted) {
    try {
      for await (const event of openEventStream(fetchImpl, baseUrl, apiToken, { ...options, afterEventId })) {
        afterEventId = event.id;
        attempt = 0;
        if (rememberEventId(seenEventIds, seenEventOrder, event.id)) {
          yield event;
        }
      }
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error)) return;
      if (!reconnect || (error instanceof ZuuClientError && !error.retryable)) throw error;
      attempt += 1;
      options.onReconnect?.(attempt, afterEventId);
      await waitForReconnect(backoffDelay(reconnectDelayMs, maxReconnectDelayMs, attempt), options.signal);
      continue;
    }

    if (!reconnect) return;
    attempt += 1;
    options.onReconnect?.(attempt, afterEventId);
    await waitForReconnect(backoffDelay(reconnectDelayMs, maxReconnectDelayMs, attempt), options.signal);
  }
}

async function* openEventStream(
  fetchImpl: typeof fetch,
  baseUrl: string,
  apiToken: string | undefined,
  options: EventStreamOptions,
): AsyncGenerator<PromptStreamEvent> {
  const path = withQuery("/v1/events", {
    runId: options.runId,
    sessionId: options.sessionId,
    afterEventId: options.afterEventId,
  });
  const response = await fetchImpl(joinUrl(baseUrl, path), {
    headers: {
      ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}),
      ...(options.afterEventId ? { "last-event-id": options.afterEventId } : {}),
    },
    signal: options.signal,
  });

  if (!response.ok || !response.body) {
    await parseJsonResponse(response);
    return;
  }

  options.onOpen?.();
  yield* readPromptStream(response);
}

async function* readPromptStream(response: Response): AsyncGenerator<PromptStreamEvent> {
  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
  if (!reader) return;
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const parsed = parseSseEvents(buffer + value);
      buffer = parsed.rest;
      for (const event of parsed.events) {
        yield event;
      }
    }

    const parsed = parseSseEvents(`${buffer}\n\n`);
    for (const event of parsed.events) {
      yield event;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function parseSseEvents(buffer: string) {
  const frames = buffer.split("\n\n");
  const rest = frames.pop() ?? "";
  const events: PromptStreamEvent[] = [];

  for (const frame of frames) {
    const eventName = frame
      .split("\n")
      .find((line) => line.startsWith("event:"))
      ?.slice(6)
      .trimStart();
    if (eventName === "heartbeat") continue;

    const id = frame
      .split("\n")
      .find((line) => line.startsWith("id:"))
      ?.slice(3)
      .trimStart();
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");

    if (data) {
      const event = JSON.parse(data) as unknown;
      if (!id || !hasPromptStreamEnvelope(event) || event.id !== id) {
        throw new Error("Invalid SSE event frame");
      }
      if (isPromptStreamEvent(event)) events.push(event);
    }
  }

  return { events, rest };
}

function hasPromptStreamEnvelope(value: unknown): value is Pick<PromptStreamEvent, "id" | "createdAt" | "runId"> & { type: string } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      typeof value.id === "string" &&
      "createdAt" in value &&
      typeof value.createdAt === "string" &&
      "runId" in value &&
      typeof value.runId === "string" &&
      "type" in value &&
      typeof value.type === "string",
  );
}

function isPromptStreamEvent(value: unknown): value is PromptStreamEvent {
  return hasPromptStreamEnvelope(value) && PROMPT_STREAM_EVENT_TYPES.has(value.type as PromptStreamEvent["type"]);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function rememberEventId(seenEventIds: Set<string>, seenEventOrder: string[], eventId: string) {
  if (seenEventIds.has(eventId)) return false;
  seenEventIds.add(eventId);
  seenEventOrder.push(eventId);
  if (seenEventOrder.length > 1_024) {
    const expiredEventId = seenEventOrder.shift();
    if (expiredEventId) seenEventIds.delete(expiredEventId);
  }
  return true;
}

function backoffDelay(baseMs: number, maxMs: number, attempt: number) {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

function waitForReconnect(delayMs: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, delayMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}
