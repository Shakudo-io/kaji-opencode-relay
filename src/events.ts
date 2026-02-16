export type EventHandler<Payload> = (payload: Payload) => void
export type Unsubscribe = () => void

export class TypedEmitter<EventMap extends Record<string, unknown>> {
  private handlers = new Map<keyof EventMap, Set<EventHandler<EventMap[keyof EventMap]>>>()

  on<EventKey extends keyof EventMap>(event: EventKey, handler: EventHandler<EventMap[EventKey]>): Unsubscribe {
    const existing = this.handlers.get(event)
    if (existing) {
      existing.add(handler as EventHandler<EventMap[keyof EventMap]>)
    } else {
      this.handlers.set(event, new Set([handler as EventHandler<EventMap[keyof EventMap]>]))
    }
    return () => this.off(event, handler)
  }

  once<EventKey extends keyof EventMap>(event: EventKey, handler: EventHandler<EventMap[EventKey]>): Unsubscribe {
    const wrapped: EventHandler<EventMap[EventKey]> = (payload) => {
      this.off(event, wrapped)
      handler(payload)
    }
    return this.on(event, wrapped)
  }

  off<EventKey extends keyof EventMap>(event: EventKey, handler: EventHandler<EventMap[EventKey]>): void {
    const existing = this.handlers.get(event)
    if (!existing) return
    existing.delete(handler as EventHandler<EventMap[keyof EventMap]>)
    if (existing.size === 0) {
      this.handlers.delete(event)
    }
  }

  emit<EventKey extends keyof EventMap>(event: EventKey, payload: EventMap[EventKey]): void {
    const existing = this.handlers.get(event)
    if (!existing) return
    for (const handler of existing) {
      ;(handler as EventHandler<EventMap[EventKey]>)(payload)
    }
  }
}
