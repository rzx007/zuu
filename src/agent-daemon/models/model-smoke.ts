import type {
  ModelSmokeRequest,
  ModelSmokeResponse,
  PromptRequest,
  PromptStreamEvent,
  RunSummary,
} from "@zuu/client";

interface ModelSmokeDeps {
  prompt(request: PromptRequest): AsyncGenerator<PromptStreamEvent>;
  abortSession(sessionId: string): Promise<unknown>;
  deleteSession(sessionId: string): Promise<unknown>;
}

export async function runModelSmoke(request: ModelSmokeRequest = {}, deps: ModelSmokeDeps): Promise<ModelSmokeResponse> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const timeoutMs = request.timeoutMs ?? 60_000;
  const prompt = request.prompt?.trim() || "Reply with exactly: zuu-ok";
  let sessionId: string | undefined;
  let run: RunSummary | undefined;
  let eventCount = 0;
  let text = "";
  let error: string | undefined;
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    if (sessionId) {
      void deps.abortSession(sessionId).catch(() => {});
    }
  }, timeoutMs);
  timeout.unref?.();

  try {
    for await (const event of deps.prompt({
      projectId: request.projectId,
      prompt,
      source: "api",
      name: "Model smoke",
      model: request.model,
      thinkingLevel: request.thinkingLevel,
      tools: [],
      persist: false,
    })) {
      eventCount += 1;
      sessionId = event.session?.id ?? sessionId;
      run = event.run ?? run;
      if (event.type === "text_delta" && event.delta) text += event.delta;
      if (event.type === "error" && event.message) error = event.message;
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    clearTimeout(timeout);
    if (sessionId) {
      await deps.deleteSession(sessionId).catch(() => {});
    }
  }

  if (timedOut && !error) error = `Model smoke timed out after ${timeoutMs}ms`;
  const finishedAtMs = Date.now();
  const status = run?.status ?? "failed";
  return {
    ok: status === "completed" && !error && !timedOut,
    status,
    startedAt,
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: finishedAtMs - startedAtMs,
    eventCount,
    model: request.model,
    run,
    runId: run?.id,
    sessionId,
    textPreview: text ? text.slice(0, 500) : undefined,
    error: run?.error ?? error,
  };
}
