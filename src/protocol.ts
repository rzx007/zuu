export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface SessionSummary {
  id: string;
  name?: string;
  cwd: string;
  model?: string;
  thinkingLevel: ThinkingLevel;
  activeTools: string[];
  messageCount: number;
  isStreaming: boolean;
  sessionFile?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunSummary {
  id: string;
  sessionId: string;
  status: "running" | "done" | "error" | "aborted";
  prompt: string;
  startedAt: string;
  endedAt?: string;
}

export interface PromptRequest {
  prompt: string;
  sessionId?: string;
  name?: string;
  cwd?: string;
  model?: {
    provider: string;
    id: string;
  };
  thinkingLevel?: ThinkingLevel;
  tools?: string[];
  persist?: boolean;
}

export interface PromptStreamEvent {
  runId: string;
  type:
    | "session"
    | "text_delta"
    | "tool_start"
    | "tool_update"
    | "tool_end"
    | "agent_event"
    | "done"
    | "error";
  session?: SessionSummary;
  delta?: string;
  message?: string;
  tool?: {
    id: string;
    name: string;
    args?: unknown;
    result?: unknown;
    isError?: boolean;
  };
  eventType?: string;
  run?: RunSummary;
}

export interface HealthResponse {
  ok: boolean;
}

export interface SessionsResponse {
  sessions: SessionSummary[];
}

export interface SessionResponse {
  session: SessionSummary;
}

export interface RunsResponse {
  runs: RunSummary[];
}

export interface RunResponse {
  run: RunSummary;
}

export interface Diagnostics {
  ok: boolean;
  cwd: string;
  runtime: {
    node: string;
    platform: string;
    nodeVersionRequired: string;
  };
  sdk: {
    package: string;
    version: string;
  };
  models: {
    configuredProviders: string[];
    availableCount: number;
    active?: string;
    error?: string;
  };
  resources: {
    skills: number;
    prompts: number;
    extensions: number;
    extensionErrors: Array<{ path: string; error: string }>;
    packages: string[];
  };
  gaps: string[];
}

export interface ApiErrorResponse {
  error: {
    message: string;
    status: number;
  };
}
