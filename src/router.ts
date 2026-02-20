import { createContextualLogger, noopContextualLogger, type ContextualLogger, type Logger, type Message, type MessageOrigin, type PermissionReply, type PermissionRequest, type QuestionReply, type QuestionRequest } from "./types"
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
  private readonly pendingPromptOrigins = new Map<string, string[]>()
  private readonly timeoutMs: number
  private readonly logger: ContextualLogger
  private readonly defaultAdapterId?: string

  constructor(config: HeadlessRouterConfig) {
    this.client = config.client
    this.store = config.store
    this.adapters = new Map(config.adapters.map((adapter) => [adapter.id, adapter]))
    this.defaultAdapterId = config.defaultAdapterId
    this.timeoutMs = config.timeoutMs ?? 5 * 60 * 1000
    this.logger = config.logger ? createContextualLogger(config.logger).child({ component: "router" }) : noopContextualLogger
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

  async promptWithOrigin(sessionID: string, text: string, adapterID: string, options?: Parameters<HeadlessClient["prompt"]>[2]): Promise<unknown> {
    if (!this.adapters.has(adapterID)) {
      throw new Error(`Adapter not registered: ${adapterID}`)
    }
    this.queuePromptOrigin(sessionID, adapterID)
    return this.client.prompt(sessionID, text, options)
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
          .catch((error) => this.logger.error("router.adapter.failed", { method: "onAssistantMessage", sessionID, error: String(error) }))
      }),
      this.store.on("assistantMessageComplete", ({ sessionID, message, parts }) => {
        const adapter = this.getAdapter(sessionID)
        if (!adapter) return
        adapter
          .onAssistantMessageComplete(sessionID, message, parts)
          .catch((error) => this.logger.error("router.adapter.failed", { method: "onAssistantMessageComplete", sessionID, error: String(error) }))
      }),
      this.store.on("userMessage", ({ sessionID, message }) => {
        const adapter = this.getAdapter(sessionID)
        if (!adapter || !adapter.onInboundMessage) return

        const originAdapterId = this.shiftPromptOrigin(sessionID)
        if (originAdapterId && originAdapterId === adapter.id) return

        const origin = originAdapterId
          ? this.resolveOrigin(originAdapterId)
          : { adapterId: "tui", channel: "terminal" }
        const text = this.resolveUserMessageText(sessionID, message)

        adapter
          .onInboundMessage(sessionID, text, origin)
          .catch((error) => this.logger.error("router.adapter.failed", { method: "onInboundMessage", sessionID, error: String(error) }))
      }),
      this.store.on("sessionStatus", ({ sessionID, status }) => {
        const adapter = this.getAdapter(sessionID)
        if (!adapter) return
        try {
          adapter.onSessionStatus(sessionID, status)
        } catch (error) {
          this.logger.error("router.adapter.failed", { method: "onSessionStatus", sessionID, error: String(error) })
        }
      }),
      this.store.on("sessionCreated", ({ sessionID, session }) => {
        const adapter = this.getAdapter(sessionID)
        if (!adapter || !adapter.onSessionCreated) return
        adapter
          .onSessionCreated(sessionID, session)
          .catch((error) => this.logger.error("router.adapter.failed", { method: "onSessionCreated", sessionID, error: String(error) }))
      }),
      this.store.on("sessionDeleted", ({ sessionID }) => {
        const adapter = this.getAdapter(sessionID)
        this.pendingPromptOrigins.delete(sessionID)
        if (!adapter || !adapter.onSessionDeleted) return
        adapter
          .onSessionDeleted(sessionID)
          .catch((error) => this.logger.error("router.adapter.failed", { method: "onSessionDeleted", sessionID, error: String(error) }))
      }),
      this.store.on("todo", ({ sessionID, todos }) => {
        const adapter = this.getAdapter(sessionID)
        if (!adapter) return
        try {
          adapter.onTodoUpdate(sessionID, todos)
        } catch (error) {
          this.logger.error("router.adapter.failed", { method: "onTodoUpdate", sessionID, error: String(error) })
        }
      }),
      this.store.on("sessionError", ({ sessionID, error }) => {
        const adapter = this.getAdapter(sessionID)
        if (!adapter) return
        try {
          adapter.onSessionError(sessionID, error)
        } catch (adapterError) {
          this.logger.error("router.adapter.failed", { method: "onSessionError", sessionID, error: String(adapterError) })
        }
      }),
      this.store.on("toast", ({ notification }) => {
        for (const adapter of this.adapters.values()) {
          try {
            adapter.onToast(notification)
          } catch (error) {
            this.logger.error("router.adapter.failed", { method: "onToast", error: String(error) })
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

  private queuePromptOrigin(sessionID: string, adapterID: string): void {
    const queue = this.pendingPromptOrigins.get(sessionID)
    if (queue) {
      queue.push(adapterID)
    } else {
      this.pendingPromptOrigins.set(sessionID, [adapterID])
    }
  }

  private shiftPromptOrigin(sessionID: string): string | undefined {
    const queue = this.pendingPromptOrigins.get(sessionID)
    if (!queue || queue.length === 0) return undefined
    const origin = queue.shift()
    if (queue.length === 0) {
      this.pendingPromptOrigins.delete(sessionID)
    }
    return origin
  }

  private resolveOrigin(adapterId: string): MessageOrigin {
    const adapter = this.adapters.get(adapterId)
    if (adapter) {
      return { adapterId, channel: adapter.channel }
    }
    return { adapterId, channel: "unknown" }
  }

  private resolveUserMessageText(sessionID: string, message: Message): string {
    const parts = this.store.parts(message.id).filter((part) => part.type === "text")
    const partText = parts
      .map((part) => (part as { text?: string }).text)
      .filter((text): text is string => typeof text === "string" && text.length > 0)
      .join("")
    if (partText.length > 0) return partText

    const record = message as Record<string, unknown>
    const summary = record.summary as Record<string, unknown> | undefined
    const body = summary?.body
    if (typeof body === "string" && body.length > 0) return body
    const title = summary?.title
    if (typeof title === "string" && title.length > 0) return title

    this.logger.warn("router.user.message.empty", { sessionID, messageID: message.id })
    return ""
  }

  private async handlePermission(sessionID: string, request: PermissionRequest): Promise<void> {
    const adapter = this.getAdapter(sessionID)
    if (!adapter) {
      this.logger.warn("router.permission.auto-rejected", { sessionID, requestID: request.id, reason: "no adapter" })
      await this.replyPermission(sessionID, request.id, { reply: "reject" })
      return
    }
    try {
      this.logger.info("router.permission.dispatch", { sessionID, requestID: request.id, adapterID: adapter.id })
      const reply = await this.withTimeout(adapter.onPermissionRequest(sessionID, request), "permission")
      await this.replyPermission(sessionID, request.id, reply)
    } catch (error) {
      const errorMessage = String(error)
      if (errorMessage.includes("timed out")) {
        this.logger.warn("router.permission.timeout", { sessionID, requestID: request.id })
      }
      this.logger.error("router.permission.failed", { sessionID, requestID: request.id, error: errorMessage })
      await this.replyPermission(sessionID, request.id, { reply: "reject" })
    }
  }

  private async handleQuestion(sessionID: string, request: QuestionRequest): Promise<void> {
    const adapter = this.getAdapter(sessionID)
    if (!adapter) {
      this.logger.warn("router.question.auto-rejected", { sessionID, requestID: request.id, reason: "no adapter" })
      await this.rejectQuestion(sessionID, request.id)
      return
    }
    try {
      this.logger.info("router.question.dispatch", { sessionID, requestID: request.id, adapterID: adapter.id })
      const reply = await this.withTimeout(adapter.onQuestionRequest(sessionID, request), "question")
      await this.replyQuestion(sessionID, request.id, reply)
    } catch (error) {
      this.logger.error("router.question.failed", { sessionID, requestID: request.id, error: String(error) })
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
