import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Type } from "typebox";
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  DefaultResourceLoader,
  defineTool,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  type SessionEntry,
  type SessionInfo,
  type SessionTreeNode,
} from "@earendil-works/pi-coding-agent";
import type {
  Diagnostics,
  ForkSessionRequest,
  ImportSessionRequest,
  NewSessionRequest,
  OpenSessionRequest,
  PromptRequest,
  PromptStreamEvent,
  RunSummary,
  SessionActionResponse,
  SessionSummary,
  SessionTreeEntry,
  StoredSessionSummary,
  SwitchSessionRequest,
  ThinkingLevel,
} from "./protocol";

const DEFAULT_READ_ONLY_TOOLS = ["read", "grep", "find", "ls", "zuu_status"];
const DEFAULT_AGENT_DIR = join(process.cwd(), ".zuu", "pi-agent");
const RUN_HISTORY_LIMIT = 200;

interface ManagedRuntime {
  runtime: AgentSessionRuntime;
  cwd: string;
  createdAt: string;
  updatedAt: string;
}

interface CreateSessionOptions {
  cwd?: string;
  name?: string;
  sessionFile?: string;
  continueRecent?: boolean;
  model?: PromptRequest["model"];
  thinkingLevel?: ThinkingLevel;
  tools?: string[];
  persist?: boolean;
}

function sdkVersion() {
  const packageJsonPath = join(process.cwd(), "node_modules", "@earendil-works", "pi-coding-agent", "package.json");
  return JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string; engines?: { node?: string } };
}

function getZuuAgentDir() {
  const agentDir = process.env.ZUU_AGENT_DIR || DEFAULT_AGENT_DIR;
  mkdirSync(agentDir, { recursive: true });
  return agentDir;
}

function getSessionDir(agentDir: string) {
  const sessionDir = join(agentDir, "sessions");
  mkdirSync(sessionDir, { recursive: true });
  return sessionDir;
}

function getRunStorePath(agentDir: string) {
  return join(agentDir, "runs.json");
}

function loadRunHistory(path: string): RunSummary[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((run): run is RunSummary => {
      return Boolean(run && typeof run === "object" && "id" in run && "sessionId" in run && "status" in run);
    });
  } catch {
    return [];
  }
}

function saveRunHistory(path: string, runs: RunSummary[]) {
  writeFileSync(path, `${JSON.stringify(runs.slice(0, RUN_HISTORY_LIMIT), null, 2)}\n`, "utf8");
}

async function createModelRuntime() {
  const agentDir = getZuuAgentDir();
  return ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
  });
}

function packageSourceToString(source: unknown): string {
  if (typeof source === "string") return source;
  if (source && typeof source === "object" && "source" in source) {
    return String((source as { source: unknown }).source);
  }
  return String(source);
}

function compactAgentEvent(event: AgentSessionEvent, runId: string): PromptStreamEvent | undefined {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    return { runId, type: "text_delta", delta: event.assistantMessageEvent.delta };
  }

  if (event.type === "tool_execution_start") {
    return {
      runId,
      type: "tool_start",
      tool: { id: event.toolCallId, name: event.toolName, args: event.args },
    };
  }

  if (event.type === "tool_execution_update") {
    return {
      runId,
      type: "tool_update",
      tool: { id: event.toolCallId, name: event.toolName, args: event.args, result: event.partialResult },
    };
  }

  if (event.type === "tool_execution_end") {
    return {
      runId,
      type: "tool_end",
      tool: {
        id: event.toolCallId,
        name: event.toolName,
        result: event.result,
        isError: event.isError,
      },
    };
  }

  if (event.type === "message_end") {
    const message = event.message as { role?: string; stopReason?: string; errorMessage?: string };
    if (message.role === "assistant" && message.stopReason === "error") {
      return { runId, type: "error", message: message.errorMessage ?? "Model request failed." };
    }
  }

  if (
    event.type === "agent_start" ||
    event.type === "agent_end" ||
    event.type === "agent_settled" ||
    event.type === "compaction_start" ||
    event.type === "compaction_end" ||
    event.type === "queue_update" ||
    event.type === "thinking_level_changed"
  ) {
    return { runId, type: "agent_event", eventType: event.type };
  }

  return undefined;
}

function isTextPart(part: unknown): part is { type: "text"; text: string } {
  return Boolean(
    part &&
      typeof part === "object" &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string",
  );
}

function entryText(entry: SessionEntry) {
  if (entry.type !== "message") return undefined;
  if (!("content" in entry.message)) return undefined;
  const content = entry.message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  return content
    .filter(isTextPart)
    .map((part) => part.text)
    .join("");
}

function entryRole(entry: SessionEntry) {
  if (entry.type !== "message" || !("role" in entry.message)) return undefined;
  return entry.message.role;
}

export class ZuuDaemon {
  private readonly runtimes = new Map<string, ManagedRuntime>();
  private readonly runStorePath = getRunStorePath(getZuuAgentDir());
  private readonly runs = new Map<string, RunSummary>(
    loadRunHistory(this.runStorePath).map((run) => [run.id, run]),
  );
  private readonly modelRuntimePromise = createModelRuntime();
  private readonly startedAt = new Date().toISOString();
  private sdkInfoPromise: ReturnType<typeof sdkVersion> | undefined;

  private getSdkInfo() {
    this.sdkInfoPromise ??= sdkVersion();
    return this.sdkInfoPromise;
  }

  private createStatusTool(cwd: string, settingsManager: SettingsManager, resourceLoader: DefaultResourceLoader) {
    const statusTool = defineTool({
      name: "zuu_status",
      label: "Zuu Status",
      description: "Report daemon, session, model, and resource status for this Zuu agent app.",
      parameters: Type.Object({}),
      execute: async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                daemonStartedAt: this.startedAt,
                cwd,
                sessions: this.runtimes.size,
                packages: settingsManager.getPackages().map(packageSourceToString),
                resources: {
                  skills: resourceLoader.getSkills().skills.length,
                  prompts: resourceLoader.getPrompts().prompts.length,
                  extensions: resourceLoader.getExtensions().extensions.length,
                },
              },
              null,
              2,
            ),
          },
        ],
        details: {},
      }),
    });

    return statusTool;
  }

  private createRuntimeFactory(options: CreateSessionOptions): CreateAgentSessionRuntimeFactory {
    return async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
      const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
      const modelRuntime = await this.modelRuntimePromise;
      const services = await createAgentSessionServices({
        cwd,
        agentDir,
        modelRuntime,
        settingsManager,
        resourceLoaderOptions: {
          appendSystemPrompt: [
            "You are running inside Zuu, a small daemon-hosted Pi SDK agent app.",
            "Be explicit about files changed, commands run, and assumptions.",
          ],
        },
      });
      const model = options.model ? modelRuntime.getModel(options.model.provider, options.model.id) : undefined;
      const statusTool = this.createStatusTool(cwd, settingsManager, services.resourceLoader as DefaultResourceLoader);
      const result = await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        model,
        thinkingLevel: options.thinkingLevel,
        customTools: [statusTool],
        tools: options.tools ?? DEFAULT_READ_ONLY_TOOLS,
      });

      return {
        ...result,
        services,
        diagnostics: services.diagnostics,
      };
    };
  }

  private bindRuntime(managed: ManagedRuntime) {
    managed.runtime.setRebindSession(async (session) => {
      for (const [sessionId, item] of this.runtimes) {
        if (item === managed && sessionId !== session.sessionId) {
          this.runtimes.delete(sessionId);
        }
      }
      managed.cwd = managed.runtime.cwd;
      managed.updatedAt = new Date().toISOString();
      this.runtimes.set(session.sessionId, managed);
    });
  }

  private createSessionManager(options: CreateSessionOptions, cwd: string, sessionDir: string) {
    if (options.sessionFile) {
      return SessionManager.open(options.sessionFile, sessionDir, options.cwd);
    }

    if (options.continueRecent) {
      return SessionManager.continueRecent(cwd, sessionDir);
    }

    return options.persist === false ? SessionManager.inMemory(cwd) : SessionManager.create(cwd, sessionDir);
  }

  private findRuntimeBySessionFile(sessionFile: string) {
    return [...this.runtimes.values()].find((managed) => managed.runtime.session.sessionFile === sessionFile);
  }

  async createSession(options: CreateSessionOptions = {}) {
    if (options.sessionFile) {
      const existing = this.findRuntimeBySessionFile(options.sessionFile);
      if (existing) return existing.runtime.session;
    }

    const cwd = options.cwd ?? process.cwd();
    const agentDir = getZuuAgentDir();
    const sessionDir = getSessionDir(agentDir);
    const sessionManager = this.createSessionManager(options, cwd, sessionDir);
    const runtimeCwd = sessionManager.getCwd();

    const runtime = await createAgentSessionRuntime(this.createRuntimeFactory(options), {
      cwd: runtimeCwd,
      agentDir,
      sessionManager,
    });
    const session = runtime.session;

    if (options.name) session.setSessionName(options.name);

    const now = new Date().toISOString();
    const managed: ManagedRuntime = { runtime, cwd: runtime.cwd, createdAt: now, updatedAt: now };
    this.bindRuntime(managed);
    this.runtimes.set(session.sessionId, managed);
    return session;
  }

  async openSession(options: OpenSessionRequest) {
    if (!options.sessionFile || typeof options.sessionFile !== "string") {
      throw new Error("sessionFile is required");
    }

    return this.createSession({
      ...options,
      cwd: options.cwdOverride,
      sessionFile: options.sessionFile,
    });
  }

  async getOrCreateSession(options: CreateSessionOptions & { sessionId?: string }) {
    if (options.sessionId) {
      const existing = this.runtimes.get(options.sessionId);
      if (existing) return existing.runtime.session;
      throw new Error(`Unknown session: ${options.sessionId}`);
    }

    return this.createSession(options);
  }

  listSessions() {
    return [...this.runtimes.values()].map((item) => this.summarizeSession(item.runtime.session));
  }

  async listStoredSessions(cwd?: string) {
    const agentDir = getZuuAgentDir();
    const sessionDir = getSessionDir(agentDir);
    const sessions = cwd ? await SessionManager.list(cwd, sessionDir) : await SessionManager.listAll(sessionDir);
    return sessions
      .map((session) => this.summarizeStoredSession(session))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  listRuns(sessionId?: string) {
    return [...this.runs.values()]
      .filter((run) => !sessionId || run.sessionId === sessionId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  private persistRuns() {
    saveRunHistory(this.runStorePath, this.listRuns());
  }

  private setRun(run: RunSummary) {
    this.runs.set(run.id, run);
    this.persistRuns();
  }

  getRun(runId: string) {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    return run;
  }

  private getManagedRuntime(sessionId: string) {
    const managed = this.runtimes.get(sessionId);
    if (!managed) throw new Error(`Unknown session: ${sessionId}`);
    return managed;
  }

  private summarizeRuntimeAction(managed: ManagedRuntime, result: { cancelled: boolean; selectedText?: string }): SessionActionResponse {
    managed.cwd = managed.runtime.cwd;
    managed.updatedAt = new Date().toISOString();
    return {
      session: this.summarizeSession(managed.runtime.session),
      cancelled: result.cancelled,
      selectedText: result.selectedText,
    };
  }

  summarizeSession(session: AgentSession): SessionSummary {
    const managed = this.runtimes.get(session.sessionId);
    return {
      id: session.sessionId,
      name: session.sessionName,
      cwd: managed?.cwd ?? process.cwd(),
      model: session.model ? `${session.model.provider}/${session.model.id}` : undefined,
      thinkingLevel: session.thinkingLevel as ThinkingLevel,
      activeTools: session.getActiveToolNames(),
      messageCount: session.messages.length,
      isStreaming: session.isStreaming,
      sessionFile: session.sessionFile,
      createdAt: managed?.createdAt ?? new Date().toISOString(),
      updatedAt: managed?.updatedAt ?? new Date().toISOString(),
    };
  }

  summarizeStoredSession(session: SessionInfo): StoredSessionSummary {
    return {
      id: session.id,
      path: session.path,
      cwd: session.cwd,
      name: session.name,
      parentSessionPath: session.parentSessionPath,
      createdAt: session.created.toISOString(),
      updatedAt: session.modified.toISOString(),
      messageCount: session.messageCount,
      firstMessage: session.firstMessage,
      isActive: [...this.runtimes.values()].some((runtime) => runtime.runtime.session.sessionFile === session.path),
    };
  }

  summarizeSessionTree(sessionId: string) {
    const managed = this.getManagedRuntime(sessionId);
    const visit = (node: SessionTreeNode): SessionTreeEntry => ({
      id: node.entry.id,
      parentId: node.entry.parentId,
      type: node.entry.type,
      timestamp: node.entry.timestamp,
      label: node.label,
      role: entryRole(node.entry),
      text: entryText(node.entry),
      children: node.children.map(visit),
    });

    return managed.runtime.session.sessionManager.getTree().map(visit);
  }

  async *prompt(request: PromptRequest): AsyncGenerator<PromptStreamEvent> {
    const runId = crypto.randomUUID();
    const session = await this.getOrCreateSession(request);
    const managed = this.runtimes.get(session.sessionId);
    if (managed) managed.updatedAt = new Date().toISOString();

    if (request.tools) {
      session.setActiveToolsByName(request.tools);
    }

    const run: RunSummary = {
      id: runId,
      sessionId: session.sessionId,
      status: "running",
      prompt: request.prompt,
      startedAt: new Date().toISOString(),
    };
    this.setRun(run);

    yield { runId, type: "session", session: this.summarizeSession(session), run };

    const queue: PromptStreamEvent[] = [];
    let notify: (() => void) | undefined;
    let finished = false;
    let promptError: unknown;
    let sawError = false;

    const wake = () => {
      notify?.();
      notify = undefined;
    };

    const unsubscribe = session.subscribe((event) => {
      const compact = compactAgentEvent(event, runId);
      if (compact) {
        if (compact.type === "error") sawError = true;
        queue.push(compact);
        wake();
      }
    });

    session
      .prompt(request.prompt)
      .catch((error) => {
        promptError = error;
      })
      .finally(() => {
        finished = true;
        wake();
      });

    try {
      while (!finished || queue.length > 0) {
        const next = queue.shift();
        if (next) {
          yield next;
          continue;
        }

        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }

      if (promptError) {
        const message = promptError instanceof Error ? promptError.message : String(promptError);
        run.status = run.status === "aborted" ? "aborted" : "error";
        run.endedAt = new Date().toISOString();
        this.persistRuns();
        yield { runId, type: "error", message, run };
        return;
      }

      if (managed) managed.updatedAt = new Date().toISOString();
      run.status = run.status === "aborted" ? "aborted" : sawError ? "error" : "done";
      run.endedAt = new Date().toISOString();
      this.persistRuns();
      yield { runId, type: "done", session: this.summarizeSession(session), run };
    } finally {
      unsubscribe();
    }
  }

  async abort(sessionId: string) {
    const managed = this.getManagedRuntime(sessionId);
    await managed.runtime.session.abort();
    managed.updatedAt = new Date().toISOString();
    const endedAt = new Date().toISOString();
    for (const run of this.runs.values()) {
      if (run.sessionId === sessionId && run.status === "running") {
        run.status = "aborted";
        run.endedAt = endedAt;
      }
    }
    this.persistRuns();
    return this.summarizeSession(managed.runtime.session);
  }

  async compact(sessionId: string, instructions?: string) {
    const managed = this.getManagedRuntime(sessionId);
    await managed.runtime.session.compact(instructions);
    managed.updatedAt = new Date().toISOString();
    return this.summarizeSession(managed.runtime.session);
  }

  async newSession(sessionId: string, options: NewSessionRequest = {}) {
    const managed = this.getManagedRuntime(sessionId);
    const result = await managed.runtime.newSession({ parentSession: options.parentSession });
    if (!result.cancelled && options.name) {
      managed.runtime.session.setSessionName(options.name);
    }
    return this.summarizeRuntimeAction(managed, result);
  }

  async switchSession(sessionId: string, options: SwitchSessionRequest) {
    if (!options.sessionFile || typeof options.sessionFile !== "string") {
      throw new Error("sessionFile is required");
    }

    const managed = this.getManagedRuntime(sessionId);
    const result = await managed.runtime.switchSession(options.sessionFile, { cwdOverride: options.cwdOverride });
    return this.summarizeRuntimeAction(managed, result);
  }

  async forkSession(sessionId: string, options: ForkSessionRequest) {
    if (!options.entryId || typeof options.entryId !== "string") {
      throw new Error("entryId is required");
    }

    const managed = this.getManagedRuntime(sessionId);
    const result = await managed.runtime.fork(options.entryId, { position: options.position });
    return this.summarizeRuntimeAction(managed, result);
  }

  async importSession(sessionId: string, options: ImportSessionRequest) {
    if (!options.path || typeof options.path !== "string") {
      throw new Error("path is required");
    }

    const managed = this.getManagedRuntime(sessionId);
    const result = await managed.runtime.importFromJsonl(options.path, options.cwdOverride);
    return this.summarizeRuntimeAction(managed, result);
  }

  async diagnostics(): Promise<Diagnostics> {
    const cwd = process.cwd();
    const agentDir = getZuuAgentDir();
    const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
    const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
    await resourceLoader.reload();

    const modelRuntime = await this.modelRuntimePromise;
    const available = await modelRuntime.getAvailable();
    const sdk = await this.getSdkInfo();
    const extensionResult = resourceLoader.getExtensions();
    const configuredProviders = modelRuntime
      .getProviders()
      .filter((provider) => modelRuntime.hasConfiguredAuth(provider.id))
      .map((provider) => provider.id);

    const packages = settingsManager.getPackages().map(packageSourceToString);
    const gaps: string[] = [];
    if (!packages.some((item) => item.includes("@agwab/pi-workflow"))) {
      gaps.push("Workflow/subagent orchestration is not installed; add npm:@agwab/pi-workflow for reusable workflows.");
    }
    if (!packages.some((item) => item.includes("pi-crew"))) {
      gaps.push("Cron/interval/one-shot scheduling still needs a daemon scheduler adapter or a package such as pi-crew.");
    }
    if (available.length === 0) {
      gaps.push("No authenticated model is available; configure provider auth in ~/.pi/agent/auth.json or environment variables.");
    }

    return {
      ok: extensionResult.errors.length === 0 && available.length > 0,
      cwd,
      runtime: {
        node: process.versions.node,
        platform: process.platform,
        nodeVersionRequired: sdk.engines?.node ?? ">=22.19.0",
      },
      sdk: {
        package: "@earendil-works/pi-coding-agent",
        version: sdk.version,
      },
      models: {
        configuredProviders,
        availableCount: available.length,
        active: this.listSessions()[0]?.model,
        error: modelRuntime.getError(),
      },
      resources: {
        skills: resourceLoader.getSkills().skills.length,
        prompts: resourceLoader.getPrompts().prompts.length,
        extensions: extensionResult.extensions.length,
        extensionErrors: extensionResult.errors,
        packages,
      },
      gaps,
    };
  }

  async dispose() {
    for (const managed of this.runtimes.values()) {
      await managed.runtime.dispose();
    }
    this.runtimes.clear();
    this.runs.clear();
  }
}

export function getStaticPath(pathname: string) {
  return fileURLToPath(new URL(pathname, import.meta.url));
}
