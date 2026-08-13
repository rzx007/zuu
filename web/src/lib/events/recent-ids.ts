export function createRecentIdSet(limit = 2048) {
  const ids = new Set<string>()
  const order: string[] = []

  return {
    remember(id: string) {
      if (ids.has(id)) return false
      ids.add(id)
      order.push(id)
      if (order.length > limit) {
        const expired = order.shift()
        if (expired) ids.delete(expired)
      }
      return true
    },
    clear() {
      ids.clear()
      order.length = 0
    },
  }
}
