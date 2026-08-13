import type { PromptStreamEvent } from '@zuu/client'

export interface LiveEventItem {
  id: string
  type: PromptStreamEvent['type']
  runId: string
  createdAt: string
  text: string
}

export function liveEventText(event: PromptStreamEvent) {
  if (event.type === 'session') return event.session?.name || event.session?.id || 'session started'
  if (event.type === 'tool_start') return event.tool ? `tool start: ${event.tool.name}` : 'tool start'
  if (event.type === 'tool_end') return event.tool ? `tool end: ${event.tool.name}${event.tool.isError ? ' (error)' : ''}` : 'tool end'
  if (event.type === 'approval_requested') return event.approval?.title || 'approval requested'
  if (event.type === 'approval_resolved') return event.approval?.title || 'approval resolved'
  if (event.type === 'error') return event.message || 'agent error'
  if (event.type === 'done') return event.run?.status || 'done'
  if (event.type === 'agent_event') return event.eventType || 'agent event'
  return event.delta ? `text ${event.delta.length} chars` : event.type
}

export function toLiveEventItem(event: PromptStreamEvent): LiveEventItem {
  return {
    id: event.id,
    type: event.type,
    runId: event.runId,
    createdAt: event.createdAt,
    text: liveEventText(event),
  }
}
