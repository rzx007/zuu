import type { PackageOperation, Schedule, ScheduleAction, SessionTreeEntry } from '@zuu/client'

export interface FlatTreeEntry {
  entry: SessionTreeEntry
  depth: number
}

export function toDatetimeLocal(date: Date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 16)
}

export function optionalDatetimeIso(value: string) {
  return value ? new Date(value).toISOString() : undefined
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function formatUnknown(value: unknown) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function previewText(value: unknown, limit = 180) {
  const text = formatUnknown(value).trim()
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

export function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

export function flattenSessionTree(entries: SessionTreeEntry[], depth = 0): FlatTreeEntry[] {
  return entries.flatMap((entry) => [{ entry, depth }, ...flattenSessionTree(entry.children || [], depth + 1)])
}

export function scheduleTriggerLabel(schedule: Schedule) {
  if (schedule.trigger.kind === 'once') return `once at ${schedule.trigger.runAt || 'unset'}`
  if (schedule.trigger.kind === 'interval') return `every ${Math.round((schedule.trigger.everyMs || 0) / 60_000)} min`
  return `${schedule.trigger.cron || 'cron'} / ${schedule.trigger.timezone || 'UTC'}`
}

export function scheduleActionLabel(action: ScheduleAction) {
  return action.type === 'workflow' ? `workflow:${action.workflowId}` : 'prompt'
}

export function packageOperationMessage(operation: PackageOperation | undefined) {
  if (!operation) return ''
  const lastEvent = operation.events[operation.events.length - 1]
  return operation.error || lastEvent?.message || (lastEvent ? `${lastEvent.type} ${lastEvent.action}` : '')
}
