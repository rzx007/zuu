import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import ts from "typescript";
import { ZuuDaemon } from "./agent-daemon";
import type { PromptRequest } from "./protocol";

const app = new Hono();
const daemon = new ZuuDaemon();
let clientJsPromise: Promise<string> | undefined;

function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : String(error);
  return { error: { message, status } };
}

async function getClientJs() {
  clientJsPromise ??= readFile(new URL("./client.ts", import.meta.url), "utf8").then((source) => {
    return ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      },
    }).outputText;
  });
  return clientJsPromise;
}

const page = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Zuu Agent</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f7f7f4;
      --panel: #ffffff;
      --panel-2: #f0f3f1;
      --text: #1d211f;
      --muted: #68736e;
      --line: #d8ded9;
      --accent: #0f766e;
      --accent-2: #22577a;
      --danger: #b42318;
      --shadow: 0 10px 30px rgba(20, 30, 25, 0.08);
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #101412;
        --panel: #191f1c;
        --panel-2: #202823;
        --text: #eef4ef;
        --muted: #9ba8a1;
        --line: #334039;
        --accent: #2dd4bf;
        --accent-2: #93c5fd;
        --danger: #f87171;
        --shadow: none;
      }
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }

    .app {
      display: grid;
      grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
      min-height: 100vh;
    }

    aside {
      border-right: 1px solid var(--line);
      background: var(--panel-2);
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    main {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      min-height: 100vh;
    }

    header {
      padding: 18px 22px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: var(--panel);
    }

    h1, h2 {
      margin: 0;
      font-size: 18px;
      line-height: 1.2;
    }

    h2 { font-size: 14px; color: var(--muted); font-weight: 650; }
    p { margin: 0; }

    .brand {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--muted);
      font-size: 13px;
      white-space: nowrap;
    }

    .dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--accent);
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      padding: 14px;
    }

    .stack { display: flex; flex-direction: column; gap: 12px; }
    .meta { color: var(--muted); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }

    label {
      display: flex;
      flex-direction: column;
      gap: 6px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
    }

    input, textarea, select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel);
      color: var(--text);
      padding: 10px 11px;
      font: inherit;
      font-size: 14px;
      outline: none;
    }

    textarea {
      min-height: 96px;
      resize: vertical;
      line-height: 1.45;
    }

    input:focus, textarea:focus, select:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
    }

    button {
      appearance: none;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel);
      color: var(--text);
      min-height: 38px;
      padding: 0 12px;
      font: inherit;
      font-size: 14px;
      cursor: pointer;
    }

    button.primary {
      border-color: var(--accent);
      background: var(--accent);
      color: #ffffff;
      font-weight: 700;
    }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }

    .actions {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }

    .messages {
      overflow: auto;
      padding: 22px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .message {
      max-width: 920px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 13px 14px;
      background: var(--panel);
      white-space: pre-wrap;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }

    .message.user {
      align-self: flex-end;
      background: color-mix(in srgb, var(--accent-2) 10%, var(--panel));
    }

    .message.agent { align-self: flex-start; }
    .message.event {
      align-self: stretch;
      max-width: none;
      color: var(--muted);
      font-size: 12px;
      background: transparent;
      box-shadow: none;
    }

    .composer {
      border-top: 1px solid var(--line);
      background: var(--panel);
      padding: 14px 18px 18px;
    }

    .composer-inner {
      max-width: 980px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: end;
    }

    .checks {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .check {
      display: inline-flex;
      flex-direction: row;
      align-items: center;
      gap: 7px;
      padding: 7px 9px;
      border: 1px solid var(--line);
      border-radius: 6px;
      font-weight: 600;
      color: var(--text);
    }

    .check input {
      width: 15px;
      height: 15px;
      padding: 0;
    }

    @media (max-width: 780px) {
      .app { grid-template-columns: 1fr; }
      aside { border-right: 0; border-bottom: 1px solid var(--line); }
      main { min-height: 70vh; }
      header { align-items: flex-start; flex-direction: column; }
      .composer-inner { grid-template-columns: 1fr; }
      .messages { padding: 16px; }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside>
      <div class="brand">
        <h1>Zuu Agent</h1>
        <p class="meta">Pi SDK daemon shell with typed HTTP, SSE streaming, model diagnostics, sessions, tools, and package readiness checks.</p>
      </div>

      <section class="panel stack">
        <h2>Runtime</h2>
        <p id="diag" class="meta">Loading diagnostics...</p>
      </section>

      <section class="panel stack">
        <h2>Session</h2>
        <label>Session name <input id="name" value="Zuu demo" /></label>
        <label>Provider <input id="provider" placeholder="anthropic" /></label>
        <label>Model <input id="model" placeholder="claude-opus-4-5" /></label>
        <label>Thinking
          <select id="thinking">
            <option value="off">off</option>
            <option value="low">low</option>
            <option value="medium" selected>medium</option>
            <option value="high">high</option>
          </select>
        </label>
        <div class="checks" aria-label="tools">
          <label class="check"><input type="checkbox" value="read" checked />read</label>
          <label class="check"><input type="checkbox" value="grep" checked />grep</label>
          <label class="check"><input type="checkbox" value="find" checked />find</label>
          <label class="check"><input type="checkbox" value="ls" checked />ls</label>
          <label class="check"><input type="checkbox" value="bash" />bash</label>
          <label class="check"><input type="checkbox" value="edit" />edit</label>
          <label class="check"><input type="checkbox" value="write" />write</label>
          <label class="check"><input type="checkbox" value="zuu_status" checked />status</label>
        </div>
      </section>
    </aside>

    <main>
      <header>
        <div class="brand">
          <h1 id="title">New session</h1>
          <p id="subtitle" class="meta">Ask the agent to inspect this project or call the status tool.</p>
        </div>
        <span class="status"><span class="dot"></span><span id="state">ready</span></span>
      </header>

      <section id="messages" class="messages" aria-live="polite"></section>

      <section class="composer">
        <div class="composer-inner">
          <textarea id="prompt">Use the zuu_status tool, then explain whether this app has workflow and scheduler support installed.</textarea>
          <div class="actions">
            <button id="abort">Abort</button>
            <button id="send" class="primary">Send</button>
          </div>
        </div>
      </section>
    </main>
  </div>

  <script type="module">
    import { createZuuClient } from "/client.js";

    const client = createZuuClient();
    const state = { sessionId: undefined, controller: undefined };
    const el = (id) => document.getElementById(id);
    const messages = el("messages");

    function addMessage(kind, text = "") {
      const node = document.createElement("div");
      node.className = "message " + kind;
      node.textContent = text;
      messages.appendChild(node);
      messages.scrollTop = messages.scrollHeight;
      return node;
    }

    function setBusy(busy) {
      el("send").disabled = busy;
      el("state").textContent = busy ? "running" : "ready";
    }

    function selectedTools() {
      return [...document.querySelectorAll(".check input:checked")].map((input) => input.value);
    }

    async function loadDiagnostics() {
      const diagnostics = await client.diagnostics();
      const gaps = diagnostics.gaps.length ? "\nGaps:\n- " + diagnostics.gaps.join("\n- ") : "";
      el("diag").textContent =
        "SDK " + diagnostics.sdk.version +
        "\nModels: " + diagnostics.models.availableCount +
        "\nExtensions: " + diagnostics.resources.extensions +
        "\nSkills: " + diagnostics.resources.skills +
        "\nPackages: " + (diagnostics.resources.packages.join(", ") || "none") +
        gaps;
    }

    async function sendPrompt() {
      const prompt = el("prompt").value.trim();
      if (!prompt) return;

      const provider = el("provider").value.trim();
      const model = el("model").value.trim();
      const body = {
        prompt,
        sessionId: state.sessionId,
        name: el("name").value.trim() || undefined,
        thinkingLevel: el("thinking").value,
        tools: selectedTools(),
        model: provider && model ? { provider, id: model } : undefined,
      };

      addMessage("user", prompt);
      const agentNode = addMessage("agent", "");
      setBusy(true);
      state.controller = new AbortController();

      try {
        for await (const event of client.prompt(body, { signal: state.controller.signal })) {
          if (event.type === "session" && event.session) {
            state.sessionId = event.session.id;
            el("title").textContent = event.session.name || event.session.id;
            el("subtitle").textContent = event.session.model || "No model selected";
            addMessage("event", "run start: " + event.runId);
          } else if (event.type === "text_delta") {
            agentNode.textContent += event.delta || "";
            messages.scrollTop = messages.scrollHeight;
          } else if (event.type === "tool_start") {
            addMessage("event", "tool start: " + event.tool.name);
          } else if (event.type === "tool_end") {
            addMessage("event", "tool end: " + event.tool.name + (event.tool.isError ? " (error)" : ""));
          } else if (event.type === "error") {
            addMessage("event", "error: " + event.message);
          } else if (event.type === "done" && event.session) {
            el("subtitle").textContent = (event.session.model || "No model selected") + " · " + (event.run?.status || "done");
          }
        }
      } catch (error) {
        if (error.name !== "AbortError") addMessage("event", String(error.message || error));
      } finally {
        state.controller = undefined;
        setBusy(false);
      }
    }

    async function abortPrompt() {
      state.controller?.abort();
      if (state.sessionId) {
        await client.abort(state.sessionId).catch(() => {});
      }
      setBusy(false);
    }

    el("send").addEventListener("click", sendPrompt);
    el("abort").addEventListener("click", abortPrompt);
    el("prompt").addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") sendPrompt();
    });

    loadDiagnostics().catch((error) => {
      el("diag").textContent = String(error.message || error);
    });
  </script>
</body>
</html>`;

app.get("/client.js", async () => {
  return new Response(await getClientJs(), {
    headers: { "content-type": "application/javascript; charset=utf-8" },
  });
});

app.get("/", (c) => c.html(page));

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/diagnostics", async (c) => {
  try {
    return c.json(await daemon.diagnostics());
  } catch (error) {
    return c.json(jsonError(error, 500), 500);
  }
});

app.get("/api/sessions", (c) => c.json({ sessions: daemon.listSessions() }));

app.post("/api/sessions", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const session = await daemon.createSession(body);
    return c.json({ session: daemon.summarizeSession(session) }, 201);
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

app.post("/api/prompt", async (c) => {
  let request: PromptRequest;
  try {
    request = await c.req.json();
    if (!request.prompt || typeof request.prompt !== "string") {
      return c.json(jsonError("prompt is required", 400), 400);
    }
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }

  return streamSSE(c, async (stream) => {
    try {
      for await (const event of daemon.prompt(request)) {
        if (stream.aborted) break;
        await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      }
    } catch (error) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({
          runId: "unknown",
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
      });
    }
  });
});

app.post("/api/sessions/:sessionId/abort", async (c) => {
  try {
    const session = await daemon.abort(c.req.param("sessionId"));
    return c.json({ session });
  } catch (error) {
    return c.json(jsonError(error, 404), 404);
  }
});

app.post("/api/sessions/:sessionId/compact", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const session = await daemon.compact(c.req.param("sessionId"), body.instructions);
    return c.json({ session });
  } catch (error) {
    return c.json(jsonError(error, 404), 404);
  }
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  serve({ fetch: app.fetch, port });
  console.log(`Zuu Agent listening on http://localhost:${port}`);
}

export default app;
