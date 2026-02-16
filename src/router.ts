import { noopLogger, type Logger, type PermissionReply, type PermissionRequest, type QuestionReply, type QuestionRequest } from "./types"
import type { ChannelAdapter } from "./adapter"
import type { HeadlessClient } from "./client"
import type { SyncStore } from "./store"

export type HeadlessRouterConfig = {
  client: HeadlessClient
  store: SyncStore
  adapters: ChannelAdapter[]
  defaultAdapterId?: string
  timeoutMs?: number
  logger?: Logger
}

export class HeadlessRouter {
  private readonly client: HeadlessClient
  private readonly store: SyncStore
  private readonly adapters: Map<string, ChannelAdapter>
  private readonly sessionAdapters = new Map<string, string>()
  private readonly unsubscribers: Array<() => void> = []
  private readonly timeoutMs: number
  private readonly logger: Logger
  private readonly defaultAdapterId?: string

  constructor(config: HeadlessRouterConfig) {
    this.client = config.client
    this.store = config.store
    this.adapters = new Map(config.adapters.map((adapter) => [adapter.id, adapter]))
    this.defaultAdapterId = config.defaultAdapterId
    this.timeoutMs = config.timeoutMs ?? 5 * 60 * 1000
    this.logger = config.logger ?? noopLogger
    this.subscribe()
  }

  async initialize(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.initialize?.()
    }
  }

  async shutdown(): Promise<void> {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe()
    }
    this.unsubscribers.length = 0
    for (const adapter of this.adapters.values()) {
      await adapter.shutdown?.()
    }
  }

  setSessionAdapter(sessionID: string, adapterID: string): void {
    if (!this.adapters.has(adapterID)) {
      throw new Error(`Adapter not registered: ${adapterID}`)
    }
    this.sessionAdapters.set(sessionID, adapterID)
  }

  clearSessionAdapter(sessionID: string): void {
    this.sessionAdapters.delete(sessionID)
  }

  private subscribe(): void {
    this.unsubscribers.push(
      this.store.on("permission", ({ sessionID, request }) => {
        void this.handlePermission(sessionID, request)
      }),
      this.store.on("question", ({ sessionID, request }) => {
        void this.handleQuestion(sessionID, request)
      }),
      this.store.on("assistantMessage", ({ sessionID, message, parts }) => {
        const adapter = this.getAdapter(sessionID)
        if (!adapter) return
        adapter
          .onAssistantMessage(sessionID, message, parts)
          .catch((error) => this.logger.error("Adapter assistant message failed", error))
      }),
      this.store.on("assistantMessageComplete", ({ sessionID, message, parts }) => {
        const adapter = this.getAdapter(sessionID)
        if (!adapter) return
        adapter
          .onAssistantMessageComplete(sessionID, message, parts)
          .catch((error) => this.logger.error("Adapter assistant completion failed", error))
      }),
      this.store.on("sessionStatus", ({ sessionID, status }) => {
        const adapter = this.getAdapter(sessionID)
        if (!adapter) return
        try {
          adapter.onSessionStatus(sessionID, status)
        } catch (error) {
          this.logger.error("Adapter session status failed", error)
        }
      }),
      this.store.on("todo", ({ sessionID, todos }) => {
        const adapter = this.getAdapter(sessionID)
        if (!adapter) return
        try {
          adapter.onTodoUpdate(sessionID, todos)
        } catch (error) {
          this.logger.error("Adapter todo update failed", error)
        }
      }),
      this.store.on("sessionError", ({ sessionID, error }) => {
        const adapter = this.getAdapter(sessionID)
        if (!adapter) return
        try {
          adapter.onSessionError(sessionID, error)
        } catch (adapterError) {
          this.logger.error("Adapter session error failed", adapterError)
        }
      }),
      this.store.on("toast", ({ notification }) => {
        for (const adapter of this.adapters.values()) {
          try {
            adapter.onToast(notification)
          } catch (error) {
            this.logger.error("Adapter toast failed", error)
          }
        }
      }),
    )
  }

  private getAdapter(sessionID: string): ChannelAdapter | undefined {
    const mapped = this.sessionAdapters.get(sessionID) ?? this.defaultAdapterId
    if (mapped) return this.adapters.get(mapped)
    if (this.adapters.size === 1) return this.adapters.values().next().value
    return undefined
  }

  private async handlePermission(sessionID: string, request: PermissionRequest): Promise<void> {
    const adapter = this.getAdapter(sessionID)
    if (!adapter) {
      await this.replyPermission(sessionID, request.id, { reply: "reject" })
      return
    }
    try {
      const reply = await this.withTimeout(adapter.onPermissionRequest(sessionID, request), "permission")
      await this.replyPermission(sessionID, request.id, reply)
    } catch (error) {
      this.logger.error("Adapter permission failed", error)
      await this.replyPermission(sessionID, request.id, { reply: "reject" })
    }
  }

  private async handleQuestion(sessionID: string, request: QuestionRequest): Promise<void> {
    const adapter = this.getAdapter(sessionID)
    if (!adapter) {
      await this.rejectQuestion(sessionID, request.id)
      return
    }
    try {
      const reply = await this.withTimeout(adapter.onQuestionRequest(sessionID, request), "question")
      await this.replyQuestion(sessionID, request.id, reply)
    } catch (error) {
      this.logger.error("Adapter question failed", error)
      await this.rejectQuestion(sessionID, request.id)
    }
  }

  private async replyPermission(sessionID: string, requestID: string, reply: PermissionReply): Promise<void> {
    await this.client.permission.reply({
      sessionID,
      requestID,
      reply: reply.reply,
      message: reply.message,
    })
  }

  private async replyQuestion(sessionID: string, requestID: string, reply: QuestionReply): Promise<void> {
    if ("rejected" in reply) {
      await this.rejectQuestion(sessionID, requestID)
      return
    }
    await this.client.question.reply({
      sessionID,
      requestID,
      answers: reply.answers,
    })
  }

  private async rejectQuestion(sessionID: string, requestID: string): Promise<void> {
    await this.client.question.reject({ sessionID, requestID })
  }

  private async withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} request timed out`)), this.timeoutMs)
    })
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer)
    })
  }
}
