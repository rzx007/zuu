import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import ts from "typescript";
import { ZuuDaemon } from "./agent-daemon";
import type {
  ForkSessionRequest,
  ImportSessionRequest,
  NewSessionRequest,
  OpenSessionRequest,
  PackageMutationRequest,
  PromptRequest,
  SwitchSessionRequest,
} from "./protocol";

const app = new Hono();
const daemon = new ZuuDaemon();
let clientJsPromise: Promise<string> | undefined;

function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : String(error);
  return { error: { message, status } };
}

function isAuthorized(authorization: string | undefined) {
  const apiToken = process.env.ZUU_API_TOKEN?.trim();
  return !apiToken || authorization === `Bearer ${apiToken}`;
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

    .run-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 190px;
      overflow: auto;
    }

    .run-item {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px;
      background: color-mix(in srgb, var(--panel) 82%, var(--panel-2));
      font-size: 12px;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }

    .run-item strong {
      display: block;
      color: var(--text);
      font-size: 12px;
      margin-bottom: 3px;
    }

    .session-file {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px;
      background: color-mix(in srgb, var(--panel) 82%, var(--panel-2));
      font-size: 12px;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }

    .session-file strong {
      display: block;
      color: var(--text);
      font-size: 12px;
      margin-bottom: 3px;
    }

    .session-file button {
      min-height: 30px;
      padding: 0 9px;
      font-size: 12px;
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
        <label>API token <input id="api-token" type="password" placeholder="Optional ZUU_API_TOKEN" /></label>
        <div class="actions">
          <button id="save-token">Save</button>
        </div>
      </section>

      <section class="panel stack">
        <h2>Packages</h2>
        <div id="packages" class="run-list"><p class="meta">No packages configured.</p></div>
        <label>Source <input id="package-source" placeholder="npm:@agwab/pi-workflow" /></label>
        <div class="actions">
          <button id="add-package">Add</button>
        </div>
      </section>

      <section class="panel stack">
        <h2>Session</h2>
        <label>Session name <input id="name" value="Zuu demo" /></label>
        <label>Available model
          <select id="model-select">
            <option value="">Loading models...</option>
          </select>
        </label>
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

      <section class="panel stack">
        <h2>Recent runs</h2>
        <div id="runs" class="run-list"><p class="meta">No runs yet.</p></div>
      </section>

      <section class="panel stack">
        <h2>Stored sessions</h2>
        <div id="stored-sessions" class="run-list"><p class="meta">No stored sessions yet.</p></div>
      </section>

      <section class="panel stack">
        <h2>Session tree</h2>
        <div id="session-tree" class="run-list"><p class="meta">Open a session first.</p></div>
        <label>Import JSONL <input id="import-path" placeholder="D:\\path\\session.jsonl" /></label>
        <div class="actions">
          <button id="import-session">Import</button>
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

    const tokenKey = "zuu.apiToken";
    let client = createZuuClient({ apiToken: localStorage.getItem(tokenKey) || undefined });
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

    function saveToken() {
      const token = el("api-token").value.trim();
      if (token) {
        localStorage.setItem(tokenKey, token);
      } else {
        localStorage.removeItem(tokenKey);
      }
      client = createZuuClient({ apiToken: token || undefined });
      addMessage("event", token ? "API token saved." : "API token cleared.");
      loadDiagnostics().catch((error) => {
        el("diag").textContent = String(error.message || error);
      });
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

    async function loadPackages() {
      const { packages } = await client.listPackages();
      const root = el("packages");
      root.replaceChildren();

      if (!packages.length) {
        const empty = document.createElement("p");
        empty.className = "meta";
        empty.textContent = "No packages configured.";
        root.appendChild(empty);
        return;
      }

      for (const source of packages) {
        const item = document.createElement("div");
        item.className = "session-file";
        const text = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = source;
        const meta = document.createElement("span");
        meta.textContent = "Pi package source";
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Remove";
        button.addEventListener("click", async () => {
          await client.removePackage({ source });
          await Promise.all([loadPackages(), loadDiagnostics()]).catch(() => {});
        });
        text.append(title, meta);
        item.append(text, button);
        root.appendChild(item);
      }
    }

    async function loadModels() {
      const { models } = await client.listModels();
      const select = el("model-select");
      select.replaceChildren();

      if (!models.length) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No authenticated models";
        select.appendChild(option);
        return;
      }

      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "Use default model";
      select.appendChild(empty);

      for (const model of models) {
        const option = document.createElement("option");
        option.value = model.provider + "/" + model.id;
        option.textContent = model.provider + " / " + (model.label || model.id);
        option.dataset.provider = model.provider;
        option.dataset.model = model.id;
        select.appendChild(option);
      }
    }

    async function addPackage() {
      const source = el("package-source").value.trim();
      if (!source) return;
      await client.addPackage({ source });
      el("package-source").value = "";
      await Promise.all([loadPackages(), loadDiagnostics()]).catch(() => {});
    }

    async function loadRuns() {
      const { runs } = await client.listRuns(state.sessionId);
      const root = el("runs");
      root.replaceChildren();

      if (!runs.length) {
        const empty = document.createElement("p");
        empty.className = "meta";
        empty.textContent = "No runs yet.";
        root.appendChild(empty);
        return;
      }

      for (const run of runs.slice(0, 8)) {
        const item = document.createElement("div");
        item.className = "run-item";
        const title = document.createElement("strong");
        title.textContent = run.id.slice(0, 8) + " - " + run.status;
        const meta = document.createElement("span");
        meta.textContent = run.startedAt + " - " + run.prompt;
        item.append(title, meta);
        root.appendChild(item);
      }
    }

    function setActiveSession(session) {
      state.sessionId = session.id;
      el("title").textContent = session.name || session.id;
      el("subtitle").textContent = session.model || session.sessionFile || "No model selected";
    }

    async function openStoredSession(sessionFile) {
      const { session } = await client.openSession({ sessionFile });
      setActiveSession(session);
      addMessage("event", "opened session: " + session.id);
      await Promise.all([loadRuns(), loadStoredSessions(), loadSessionTree()]).catch(() => {});
    }

    async function loadStoredSessions() {
      const { sessions } = await client.listStoredSessions();
      const root = el("stored-sessions");
      root.replaceChildren();

      if (!sessions.length) {
        const empty = document.createElement("p");
        empty.className = "meta";
        empty.textContent = "No stored sessions yet.";
        root.appendChild(empty);
        return;
      }

      for (const session of sessions.slice(0, 8)) {
        const item = document.createElement("div");
        item.className = "session-file";
        const text = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = (session.name || session.id.slice(0, 8)) + (session.isActive ? " - active" : "");
        const meta = document.createElement("span");
        meta.textContent = session.messageCount + " messages - " + session.updatedAt;
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Open";
        button.disabled = session.isActive;
        button.addEventListener("click", () => {
          openStoredSession(session.path).catch((error) => addMessage("event", String(error.message || error)));
        });
        text.append(title, meta);
        item.append(text, button);
        root.appendChild(item);
      }
    }

    function flattenTree(entries, depth = 0) {
      return entries.flatMap((entry) => [{ entry, depth }, ...flattenTree(entry.children || [], depth + 1)]);
    }

    async function forkFromEntry(entryId, position) {
      if (!state.sessionId) return;
      const result = await client.forkSession(state.sessionId, { entryId, position });
      if (!result.cancelled) {
        setActiveSession(result.session);
        addMessage("event", "forked session: " + result.session.id);
        await Promise.all([loadRuns(), loadStoredSessions(), loadSessionTree()]).catch(() => {});
      }
    }

    async function loadSessionTree() {
      const root = el("session-tree");
      root.replaceChildren();

      if (!state.sessionId) {
        const empty = document.createElement("p");
        empty.className = "meta";
        empty.textContent = "Open a session first.";
        root.appendChild(empty);
        return;
      }

      const { tree } = await client.getSessionTree(state.sessionId);
      const entries = flattenTree(tree);
      if (!entries.length) {
        const empty = document.createElement("p");
        empty.className = "meta";
        empty.textContent = "No entries yet.";
        root.appendChild(empty);
        return;
      }

      for (const { entry, depth } of entries.slice(0, 30)) {
        const item = document.createElement("div");
        item.className = "session-file";
        item.style.marginLeft = Math.min(depth * 10, 40) + "px";
        const text = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = (entry.role || entry.type) + " - " + entry.id.slice(0, 8);
        const meta = document.createElement("span");
        meta.textContent = (entry.text || entry.timestamp || "").slice(0, 120);
        const actions = document.createElement("div");
        actions.className = "actions";
        const forkBefore = document.createElement("button");
        forkBefore.type = "button";
        forkBefore.textContent = "Before";
        forkBefore.addEventListener("click", () => {
          forkFromEntry(entry.id, "before").catch((error) => addMessage("event", String(error.message || error)));
        });
        const forkAt = document.createElement("button");
        forkAt.type = "button";
        forkAt.textContent = "At";
        forkAt.addEventListener("click", () => {
          forkFromEntry(entry.id, "at").catch((error) => addMessage("event", String(error.message || error)));
        });
        text.append(title, meta);
        actions.append(forkBefore, forkAt);
        item.append(text, actions);
        root.appendChild(item);
      }
    }

    async function importSession() {
      const path = el("import-path").value.trim();
      if (!path) return;
      if (!state.sessionId) {
        const { session } = await client.createSession({ persist: false, name: "Import anchor" });
        setActiveSession(session);
      }
      const result = await client.importSession(state.sessionId, { path });
      if (!result.cancelled) {
        setActiveSession(result.session);
        el("import-path").value = "";
        addMessage("event", "imported session: " + result.session.id);
        await Promise.all([loadRuns(), loadStoredSessions(), loadSessionTree()]).catch(() => {});
      }
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
            setActiveSession(event.session);
            addMessage("event", "run start: " + event.runId);
            await Promise.all([loadRuns(), loadStoredSessions(), loadSessionTree()]).catch(() => {});
          } else if (event.type === "text_delta") {
            agentNode.textContent += event.delta || "";
            messages.scrollTop = messages.scrollHeight;
          } else if (event.type === "tool_start") {
            addMessage("event", "tool start: " + event.tool.name);
          } else if (event.type === "tool_end") {
            addMessage("event", "tool end: " + event.tool.name + (event.tool.isError ? " (error)" : ""));
          } else if (event.type === "error") {
            addMessage("event", "error: " + event.message);
            await loadRuns().catch(() => {});
          } else if (event.type === "done" && event.session) {
            el("subtitle").textContent = (event.session.model || "No model selected") + " · " + (event.run?.status || "done");
            await Promise.all([loadRuns(), loadStoredSessions(), loadSessionTree()]).catch(() => {});
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
        await Promise.all([loadRuns(), loadStoredSessions(), loadSessionTree()]).catch(() => {});
      }
      setBusy(false);
    }

    el("send").addEventListener("click", sendPrompt);
    el("abort").addEventListener("click", abortPrompt);
    el("add-package").addEventListener("click", () => {
      addPackage().catch((error) => addMessage("event", String(error.message || error)));
    });
    el("save-token").addEventListener("click", saveToken);
    el("import-session").addEventListener("click", () => {
      importSession().catch((error) => addMessage("event", String(error.message || error)));
    });
    el("model-select").addEventListener("change", () => {
      const option = el("model-select").selectedOptions[0];
      el("provider").value = option?.dataset.provider || "";
      el("model").value = option?.dataset.model || "";
    });
    el("prompt").addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") sendPrompt();
    });

    el("api-token").value = localStorage.getItem(tokenKey) || "";
    loadDiagnostics().catch((error) => {
      el("diag").textContent = String(error.message || error);
    });
    loadPackages().catch(() => {});
    loadModels().catch(() => {
      const select = el("model-select");
      select.replaceChildren();
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Failed to load models";
      select.appendChild(option);
    });
    loadRuns().catch(() => {});
    loadStoredSessions().catch(() => {});
    loadSessionTree().catch(() => {});
  </script>
</body>
</html>`;

app.get("/client.js", async () => {
  return new Response(await getClientJs(), {
    headers: { "content-type": "application/javascript; charset=utf-8" },
  });
});

app.get("/", (c) => c.html(page));

app.use("/api/*", async (c, next) => {
  if (!isAuthorized(c.req.header("authorization"))) {
    return c.json(jsonError("Unauthorized", 401), 401);
  }

  await next();
});

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/diagnostics", async (c) => {
  try {
    return c.json(await daemon.diagnostics());
  } catch (error) {
    return c.json(jsonError(error, 500), 500);
  }
});

app.get("/api/packages", (c) => c.json({ packages: daemon.listPackages() }));

app.get("/api/models", async (c) => {
  try {
    return c.json(await daemon.listModels());
  } catch (error) {
    return c.json(jsonError(error, 500), 500);
  }
});

app.post("/api/packages", async (c) => {
  try {
    const body = (await c.req.json()) as PackageMutationRequest;
    return c.json({ packages: await daemon.addPackage(body) });
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

app.delete("/api/packages", async (c) => {
  try {
    const body = (await c.req.json()) as PackageMutationRequest;
    return c.json({ packages: await daemon.removePackage(body) });
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

app.get("/api/sessions", (c) => c.json({ sessions: daemon.listSessions() }));

app.get("/api/session-files", async (c) => {
  try {
    return c.json({ sessions: await daemon.listStoredSessions(c.req.query("cwd")) });
  } catch (error) {
    return c.json(jsonError(error, 500), 500);
  }
});

app.get("/api/sessions/:sessionId/tree", (c) => {
  try {
    return c.json({ tree: daemon.summarizeSessionTree(c.req.param("sessionId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), 404);
  }
});

app.get("/api/runs", (c) => {
  const sessionId = c.req.query("sessionId");
  return c.json({ runs: daemon.listRuns(sessionId) });
});

app.get("/api/runs/:runId", (c) => {
  try {
    return c.json({ run: daemon.getRun(c.req.param("runId")) });
  } catch (error) {
    return c.json(jsonError(error, 404), 404);
  }
});

app.post("/api/sessions", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const session = await daemon.createSession(body);
    return c.json({ session: daemon.summarizeSession(session) }, 201);
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

app.post("/api/sessions/open", async (c) => {
  try {
    const body = (await c.req.json()) as OpenSessionRequest;
    const session = await daemon.openSession(body);
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

app.post("/api/sessions/:sessionId/new", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as NewSessionRequest;
    return c.json(await daemon.newSession(c.req.param("sessionId"), body));
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

app.post("/api/sessions/:sessionId/switch", async (c) => {
  try {
    const body = (await c.req.json()) as SwitchSessionRequest;
    return c.json(await daemon.switchSession(c.req.param("sessionId"), body));
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

app.post("/api/sessions/:sessionId/fork", async (c) => {
  try {
    const body = (await c.req.json()) as ForkSessionRequest;
    return c.json(await daemon.forkSession(c.req.param("sessionId"), body));
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

app.post("/api/sessions/:sessionId/import", async (c) => {
  try {
    const body = (await c.req.json()) as ImportSessionRequest;
    return c.json(await daemon.importSession(c.req.param("sessionId"), body));
  } catch (error) {
    return c.json(jsonError(error, 400), 400);
  }
});

function closeServer(server: ServerType) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function startServer(port = Number(process.env.PORT ?? 3000)) {
  const server = serve({ fetch: app.fetch, port });
  console.log(`Zuu Agent listening on http://localhost:${port}`);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = startServer();
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down Zuu Agent...`);

    try {
      await closeServer(server);
      await daemon.dispose();
      process.exit(0);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

export default app;
