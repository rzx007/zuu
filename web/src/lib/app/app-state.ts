export const STORAGE_KEYS = {
  apiToken: 'zuu.apiToken',
  eventCursor: 'zuu.lastEventId',
  projectId: 'zuu.projectId',
} as const

export const TOOL_CHOICES = ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write', 'zuu_status'] as const

export function createDefaultToolSelection(): Record<string, boolean> {
  return {
    read: true,
    grep: true,
    find: true,
    ls: true,
    bash: false,
    edit: false,
    write: false,
    zuu_status: true,
  }
}
