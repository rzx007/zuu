import type {
  AgentSessionEvent,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { PromptStreamEvent } from "../protocol";

export function compactAgentEvent(event: AgentSessionEvent, runId: string): PromptStreamEvent | undefined {
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

export function entryText(entry: SessionEntry) {
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

export function entryRole(entry: SessionEntry) {
  if (entry.type !== "message" || !("role" in entry.message)) return undefined;
  return entry.message.role;
}
