import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync } from "node:fs";
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
} from "@earendil-works/pi-coding-agent";
import type { Diagnostics, PromptRequest, PromptStreamEvent, RunSummary, SessionSummary, ThinkingLevel } from "./protocol";

const DEFAULT_READ_ONLY_TOOLS = ["read", "grep", "find", "ls", "zuu_status"];
const DEFAULT_AGENT_DIR = join(process.cwd(), ".zuu", "pi-agent");

interface ManagedRuntime {
  runtime: AgentSessionRuntime;
  cwd: string;
  createdAt: string;
  updatedAt: string;
}

interface CreateSessionOptions {
  cwd?: string;
  name?: string;
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

export class ZuuDaemon {
  private readonly runtimes = new Map<string, ManagedRuntime>();
  private readonly runs = new Map<string, RunSummary>();
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

  async createSession(options: CreateSessionOptions = {}) {
    const cwd = options.cwd ?? process.cwd();
    const agentDir = getZuuAgentDir();
    const sessionDir = join(agentDir, "sessions");
    mkdirSync(sessionDir, { recursive: true });
    const sessionManager = options.persist === false ? SessionManager.inMemory(cwd) : SessionManager.create(cwd, sessionDir);

    const runtime = await createAgentSessionRuntime(this.createRuntimeFactory(options), {
      cwd,
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

  listRuns(sessionId?: string) {
    return [...this.runs.values()]
      .filter((run) => !sessionId || run.sessionId === sessionId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
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
    this.runs.set(runId, run);

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
        yield { runId, type: "error", message, run };
        return;
      }

      if (managed) managed.updatedAt = new Date().toISOString();
      run.status = run.status === "aborted" ? "aborted" : sawError ? "error" : "done";
      run.endedAt = new Date().toISOString();
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
    return this.summarizeSession(managed.runtime.session);
  }

  async compact(sessionId: string, instructions?: string) {
    const managed = this.getManagedRuntime(sessionId);
    await managed.runtime.session.compact(instructions);
    managed.updatedAt = new Date().toISOString();
    return this.summarizeSession(managed.runtime.session);
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
