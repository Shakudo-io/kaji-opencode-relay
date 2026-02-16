import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2"
import { TypedEmitter, type Unsubscribe } from "./events"
import type {
  Event,
  Logger,
  Message,
  PermissionReply,
  PermissionRequest,
  QuestionRequest,
  Session,
} from "./types"
import { noopLogger } from "./types"

export type SdkClient = OpencodeClient
export type SdkFactoryConfig = { baseUrl: string; signal?: AbortSignal; directory?: string; fetch?: typeof fetch; headers?: RequestInit["headers"] }

export type HeadlessEventSource = {
  on: (handler: (event: Event) => void) => () => void
}

export type ModelOverride = {
  providerID: string
  modelID: string
}

export type SessionPromptOptions = {
  model?: ModelOverride
  agent?: string
  [key: string]: unknown
}

type SSEEvent = Event

export type HeadlessClientConfig = {
  url: string
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
  events?: HeadlessEventSource
  batchInterval?: number
  logger?: Logger
  /** Factory for creating SDK client — primarily for testing */
  createClient?: (config: SdkFactoryConfig) => SdkClient
}

export type ClientEventMap = {
  connected: { url: string }
  disconnected: { url: string }
  error: { error: Error }
  reconnecting: { attempt: number }
  reconnected: { attempt: number }
  event: Event
}

type EventMap = {
  [Key in Event["type"]]: Extract<Event, { type: Key }>
}

export class HeadlessClient extends TypedEmitter<ClientEventMap> {
  private readonly config: HeadlessClientConfig
  private readonly logger: Logger
  private readonly batchInterval: number
  private readonly eventEmitter = new TypedEmitter<EventMap>()
  private queue: SSEEvent[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private lastFlush = 0
  private abortController: AbortController | undefined
  private unsubscribe: (() => void) | undefined
  private _sdk: OpencodeClient | undefined
  private connected = false
  private loopActive = false

  constructor(config: HeadlessClientConfig) {
    super()
    this.config = config
    this.logger = config.logger ?? noopLogger
    this.batchInterval = config.batchInterval ?? 16
  }

  get isConnected(): boolean {
    return this.connected
  }

  get sdk(): OpencodeClient {
    if (!this._sdk) {
      throw new Error("HeadlessClient not connected")
    }
    return this._sdk
  }

  onEvent<EventKey extends Event["type"]>(event: EventKey, handler: (payload: EventMap[EventKey]) => void): Unsubscribe {
    return this.eventEmitter.on(event, handler)
  }

  onceEvent<EventKey extends Event["type"]>(event: EventKey, handler: (payload: EventMap[EventKey]) => void): Unsubscribe {
    return this.eventEmitter.once(event, handler)
  }

  get permission() {
    return {
      reply: async (input: { requestID: string; reply: PermissionReply["reply"]; message?: string; sessionID?: string }) => {
        return this.replyPermission(input.requestID, { reply: input.reply, message: input.message })
      },
    }
  }

  get question() {
    return {
      reply: async (input: { requestID: string; answers: string[][]; sessionID?: string }) => {
        return this.replyQuestion(input.requestID, input.answers)
      },
      reject: async (input: { requestID: string; sessionID?: string }) => {
        return this.rejectQuestion(input.requestID)
      },
    }
  }

  async connect(): Promise<void> {
    if (this.connected) return
    this.abortController = new AbortController()
    try {
      this._sdk = await this.resolveClient()
    } catch (error) {
      this.abortController = undefined
      const err = error instanceof Error ? error : new Error(String(error))
      this.emit("error", { error: err })
      this.logger.error("HeadlessClient connect failed", err)
      throw err
    }
    this.connected = true

    this.emit("connected", { url: this.config.url })

    if (this.config.events) {
      this.unsubscribe = this.config.events.on((event) => {
        this.handleEvent(event)
      })
      return
    }

    if (!this.loopActive) {
      this.loopActive = true
      void this.runSseLoop()
    }
  }

  disconnect(): void {
    if (!this.connected) return
    this.connected = false

    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = undefined
    }

    if (this.abortController) {
      this.abortController.abort()
      this.abortController = undefined
    }

    this.loopActive = false
    this.clearTimer()
    this.queue = []
    this.lastFlush = 0

    this.emit("disconnected", { url: this.config.url })
  }

  async bootstrap(store: { bootstrap: (sdk: OpencodeClient) => Promise<void> }): Promise<void> {
    if (!this._sdk) {
      throw new Error("HeadlessClient not connected")
    }
    try {
      await store.bootstrap(this._sdk)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.emit("error", { error: err })
      this.logger.error("HeadlessClient bootstrap failed", err)
    }
  }

  async createSession(options?: Record<string, unknown>) {
    return this.sdk.session.create(options)
  }

  async prompt(sessionID: string, text: string, options?: SessionPromptOptions) {
    return this.sdk.session.prompt({
      sessionID,
      parts: [{ id: `part_${Date.now()}`, type: "text" as const, text }],
      ...(options ?? {}),
    })
  }

  async promptWithFiles(
    sessionID: string,
    text: string,
    files: Array<{ type: "file"; mime: string; filename?: string; url: string }>,
    options?: SessionPromptOptions,
  ) {
    const textPart = { id: `part_${Date.now()}`, type: "text" as const, text }
    const fileParts = files.map((f, i) => ({ id: `part_${Date.now()}_f${i}`, ...f }))
    return this.sdk.session.prompt({
      sessionID,
      parts: [textPart, ...fileParts],
      ...(options ?? {}),
    })
  }

  async abort(sessionID: string) {
    return this.sdk.session.abort({ sessionID })
  }

  async fork(sessionID: string) {
    return this.sdk.session.fork({ sessionID })
  }

  async summarize(sessionID: string, providerID: string, modelID: string) {
    return this.sdk.session.summarize({ sessionID, providerID, modelID })
  }

  async revert(sessionID: string, messageID: string) {
    return this.sdk.session.revert({ sessionID, messageID })
  }

  async unrevert(sessionID: string) {
    return this.sdk.session.unrevert({ sessionID })
  }

  async share(sessionID: string) {
    return this.sdk.session.share({ sessionID })
  }

  async unshare(sessionID: string) {
    return this.sdk.session.unshare({ sessionID })
  }

  async deleteSession(sessionID: string) {
    return this.sdk.session.delete({ sessionID })
  }

  async executeCommand(
    sessionID: string,
    command: string,
    options?: Omit<Parameters<OpencodeClient["session"]["command"]>[0], "sessionID" | "command">,
  ) {
    return this.sdk.session.command({ sessionID, command, ...(options ?? {}) })
  }

  async replyPermission(requestID: string, reply: PermissionReply) {
    return this.sdk.permission.reply({ requestID, reply: reply.reply, message: reply.message })
  }

  async replyQuestion(requestID: string, answers: string[][]) {
    return this.sdk.question.reply({ requestID, answers })
  }

  async rejectQuestion(requestID: string) {
    return this.sdk.question.reject({ requestID })
  }

  private handleEvent(event: SSEEvent): void {
    this.queue.push(event)
    const elapsed = Date.now() - this.lastFlush

    if (this.timer) return
    if (elapsed < this.batchInterval) {
      this.timer = setTimeout(() => this.flushQueue(), this.batchInterval)
      return
    }
    this.flushQueue()
  }

  private flushQueue(): void {
    if (this.queue.length === 0) return
    const events = this.queue
    this.queue = []
    this.clearTimer()
    this.lastFlush = Date.now()
    for (const event of events) {
      this.eventEmitter.emit(event.type, event)
      this.emit("event", event)
    }
  }

  private clearTimer(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private async resolveClient(): Promise<OpencodeClient> {
    const factoryConfig: SdkFactoryConfig = {
      baseUrl: this.config.url,
      signal: this.abortController?.signal,
      directory: this.config.directory,
      fetch: this.config.fetch,
      headers: this.config.headers,
    }
    if (this.config.createClient) {
      return this.config.createClient(factoryConfig)
    }
    return createOpencodeClient(factoryConfig)
  }

  private getBackoffDelay(attempt: number): number {
    const baseDelay = 250
    const maxDelay = 5000
    return Math.min(baseDelay * 2 ** Math.max(0, attempt - 1), maxDelay)
  }

  private async delay(ms: number): Promise<void> {
    if (ms <= 0) return
    await new Promise((resolve) => setTimeout(resolve, ms))
  }

  private async runSseLoop(): Promise<void> {
    if (!this.abortController || !this._sdk) {
      this.loopActive = false
      return
    }

    const abort = this.abortController
    let attempt = 0

    while (!abort.signal.aborted) {
      if (attempt > 0) {
        this.emit("reconnecting", { attempt })
        this.logger.warn("HeadlessClient reconnecting", { attempt })
        await this.delay(this.getBackoffDelay(attempt))
        if (abort.signal.aborted) break
      }

      try {
        const subscription = await this._sdk.event.subscribe({}, { signal: abort.signal })

        if (attempt > 0) {
          this.emit("reconnected", { attempt })
        }
        attempt = 0

        for await (const event of subscription.stream) {
          this.handleEvent(event)
        }

        this.flushQueue()

        if (abort.signal.aborted) break
        attempt += 1
      } catch (error) {
        if (abort.signal.aborted) break
        const err = error instanceof Error ? error : new Error(String(error))
        this.logger.error("HeadlessClient SSE error", err)
        this.emit("error", { error: err })
        attempt += 1
      }
    }

    this.loopActive = false
  }
}
