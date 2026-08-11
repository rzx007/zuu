import type {
  Diagnostics,
  HealthResponse,
  PromptRequest,
  PromptStreamEvent,
  RunResponse,
  RunsResponse,
  SessionResponse,
  SessionsResponse,
} from "./protocol";

export interface ZuuClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface PromptStreamOptions {
  signal?: AbortSignal;
}

export interface ZuuClient {
  health(): Promise<HealthResponse>;
  diagnostics(): Promise<Diagnostics>;
  listSessions(): Promise<SessionsResponse>;
  listRuns(sessionId?: string): Promise<RunsResponse>;
  getRun(runId: string): Promise<RunResponse>;
  createSession(input?: Record<string, unknown>): Promise<SessionResponse>;
  prompt(input: PromptRequest, options?: PromptStreamOptions): AsyncGenerator<PromptStreamEvent>;
  abort(sessionId: string): Promise<SessionResponse>;
  compact(sessionId: string, instructions?: string): Promise<SessionResponse>;
}

function joinUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  return `${normalizedBase}${path}`;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: { message?: string } }).error?.message ?? response.statusText)
        : response.statusText;
    throw new Error(message);
  }

  return data as T;
}

async function requestJson<T>(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetchImpl(joinUrl(baseUrl, path), {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  return parseJsonResponse<T>(response);
}

function parseSseEvents(buffer: string) {
  const frames = buffer.split("\n\n");
  const rest = frames.pop() ?? "";
  const events: PromptStreamEvent[] = [];

  for (const frame of frames) {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");

    if (data) events.push(JSON.parse(data) as PromptStreamEvent);
  }

  return { events, rest };
}

export function createZuuClient(options: ZuuClientOptions = {}): ZuuClient {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? "";

  return {
    health: () => requestJson<HealthResponse>(fetchImpl, baseUrl, "/api/health"),
    diagnostics: () => requestJson<Diagnostics>(fetchImpl, baseUrl, "/api/diagnostics"),
    listSessions: () => requestJson<SessionsResponse>(fetchImpl, baseUrl, "/api/sessions"),
    listRuns: (sessionId) =>
      requestJson<RunsResponse>(
        fetchImpl,
        baseUrl,
        sessionId ? `/api/runs?sessionId=${encodeURIComponent(sessionId)}` : "/api/runs",
      ),
    getRun: (runId) => requestJson<RunResponse>(fetchImpl, baseUrl, `/api/runs/${encodeURIComponent(runId)}`),
    createSession: (input = {}) =>
      requestJson<SessionResponse>(fetchImpl, baseUrl, "/api/sessions", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    abort: (sessionId) =>
      requestJson<SessionResponse>(fetchImpl, baseUrl, `/api/sessions/${encodeURIComponent(sessionId)}/abort`, {
        method: "POST",
      }),
    compact: (sessionId, instructions) =>
      requestJson<SessionResponse>(fetchImpl, baseUrl, `/api/sessions/${encodeURIComponent(sessionId)}/compact`, {
        method: "POST",
        body: JSON.stringify({ instructions }),
      }),
    async *prompt(input, options = {}) {
      const response = await fetchImpl(joinUrl(baseUrl, "/api/prompt"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: options.signal,
      });

      if (!response.ok || !response.body) {
        await parseJsonResponse(response);
        return;
      }

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
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
    },
  };
}
