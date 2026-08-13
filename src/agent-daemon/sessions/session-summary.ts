import type {
  AgentSession,
  SessionInfo,
  SessionTreeNode,
} from "@earendil-works/pi-coding-agent";
import type {
  SessionActionResponse,
  SessionSummary,
  SessionTreeEntry,
  StoredSessionSummary,
  ThinkingLevel,
} from "@zuu/client";
import { entryRole, entryText } from "../core/events";

export interface SessionSummaryContext {
  projectId: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
}

export function summarizeAgentSession(session: AgentSession, context: SessionSummaryContext): SessionSummary {
  return {
    id: session.sessionId,
    projectId: context.projectId,
    name: session.sessionName,
    cwd: context.cwd,
    model: session.model ? `${session.model.provider}/${session.model.id}` : undefined,
    thinkingLevel: session.thinkingLevel as ThinkingLevel,
    activeTools: session.getActiveToolNames(),
    messageCount: session.messages.length,
    isStreaming: session.isStreaming,
    sessionFile: session.sessionFile,
    createdAt: context.createdAt,
    updatedAt: context.updatedAt,
  };
}

export function summarizeSessionTree(nodes: SessionTreeNode[]): SessionTreeEntry[] {
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

  return nodes.map(visit);
}

export function summarizeStoredSession(
  session: SessionInfo,
  options: { projectId?: string; isActive: boolean },
): StoredSessionSummary {
  return {
    id: session.id,
    path: session.path,
    projectId: options.projectId,
    cwd: session.cwd,
    name: session.name,
    parentSessionPath: session.parentSessionPath,
    createdAt: session.created.toISOString(),
    updatedAt: session.modified.toISOString(),
    messageCount: session.messageCount,
    firstMessage: session.firstMessage,
    isActive: options.isActive,
  };
}

export function summarizeSessionAction(
  session: SessionSummary,
  result: { cancelled: boolean; selectedText?: string },
): SessionActionResponse {
  return {
    session,
    cancelled: result.cancelled,
    selectedText: result.selectedText,
  };
}
