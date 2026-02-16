import type {
  Agent,
  Command,
  Config,
  Event,
  FileDiff,
  FormatterStatus,
  LspStatus,
  McpResource,
  McpStatus,
  Message,
  OpencodeClient,
  Part,
  Path,
  PermissionRequest,
  Provider,
  ProviderAuthMethod,
  ProviderListResponse,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
  VcsInfo,
} from "./types"
import type { DerivedSessionStatus, ToastNotification } from "./types"
import { Binary } from "./binary"
import { TypedEmitter } from "./events"

export type SyncStoreStatus = "loading" | "partial" | "complete"

export type SyncState = {
  status: SyncStoreStatus
  provider: Provider[]
  provider_default: Record<string, string>
  provider_next: ProviderListResponse
  provider_auth: Record<string, ProviderAuthMethod[]>
  agent: Agent[]
  command: Command[]
  permission: Record<string, PermissionRequest[]>
  question: Record<string, QuestionRequest[]>
  config: Config
  session: Session[]
  session_status: Record<string, SessionStatus>
  session_diff: Record<string, FileDiff[]>
  todo: Record<string, Todo[]>
  message: Record<string, Message[]>
  part: Record<string, Part[]>
  lsp: LspStatus[]
  mcp: Record<string, McpStatus>
  mcp_resource: Record<string, McpResource>
  formatter: FormatterStatus[]
  vcs: VcsInfo | undefined
  path: Path
  session_cost: Record<string, number>
  session_tokens: Record<string, TokenSummary>
}

export type TokenSummary = {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

type StoreEvents = {
  permission: { sessionID: string; request: PermissionRequest }
  question: { sessionID: string; request: QuestionRequest }
  todo: { sessionID: string; todos: Todo[] }
  sessionStatus: { sessionID: string; status: DerivedSessionStatus }
  assistantMessage: { sessionID: string; message: Message; parts: Part[] }
  assistantMessageComplete: { sessionID: string; message: Message; parts: Part[] }
  sessionError: { sessionID: string; error: Error }
  toast: { notification: ToastNotification }
  sessionCost: { sessionID: string; cost: number; tokens: TokenSummary }
  status: { status: SyncStoreStatus }
}

export class SyncStore extends TypedEmitter<StoreEvents> {
  state: SyncState
  private sdk: OpencodeClient | undefined
  private readonly derivedStatus = new Map<string, DerivedSessionStatus>()
  private readonly fullSyncedSessions = new Set<string>()

  constructor() {
    super()
    this.state = {
      provider_next: {
        all: [],
        default: {},
        connected: [],
      },
      provider_auth: {},
      config: {},
      status: "loading",
      agent: [],
      permission: {},
      question: {},
      command: [],
      provider: [],
      provider_default: {},
      session: [],
      session_status: {},
      session_diff: {},
      todo: {},
      message: {},
      part: {},
      lsp: [],
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
      path: { state: "", config: "", worktree: "", directory: "", home: "" },
      session_cost: {},
      session_tokens: {},
    }
  }

  snapshot(): SyncState {
    return structuredClone(this.state)
  }

  get status(): SyncStoreStatus {
    return this.state.status
  }

  get sessions(): Session[] {
    return this.state.session
  }

  get providers(): Provider[] {
    return this.state.provider
  }

  get agents(): Agent[] {
    return this.state.agent
  }

  get config(): Config {
    return this.state.config
  }

  get lspStatus(): LspStatus[] {
    return this.state.lsp
  }

  get mcpStatus(): Record<string, McpStatus> {
    return this.state.mcp
  }

  get mcpResources(): Record<string, McpResource> {
    return this.state.mcp_resource
  }

  get formatterStatus(): FormatterStatus[] {
    return this.state.formatter
  }

  get vcsInfo(): VcsInfo | undefined {
    return this.state.vcs
  }

  get path(): Path {
    return this.state.path
  }

  messages(sessionID: string): Message[] {
    return this.state.message[sessionID] ?? []
  }

  parts(messageID: string): Part[] {
    return this.state.part[messageID] ?? []
  }

  permissions(sessionID: string): PermissionRequest[] {
    return this.state.permission[sessionID] ?? []
  }

  questions(sessionID: string): QuestionRequest[] {
    return this.state.question[sessionID] ?? []
  }

  todos(sessionID: string): Todo[] {
    return this.state.todo[sessionID] ?? []
  }

  sessionCost(sessionID: string): number {
    return this.state.session_cost[sessionID] ?? 0
  }

  sessionTokens(sessionID: string): TokenSummary {
    return this.state.session_tokens[sessionID] ?? { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
  }

  async bootstrap(sdk: OpencodeClient): Promise<void> {
    this.sdk = sdk
    const start = Date.now() - 30 * 24 * 60 * 60 * 1000
    const sessionListPromise = sdk.session.list({ start })
    const providersPromise = sdk.config.providers({}, { throwOnError: true })
    const providerListPromise = sdk.provider.list({}, { throwOnError: true })
    const agentsPromise = sdk.app.agents({}, { throwOnError: true })
    const configPromise = sdk.config.get({}, { throwOnError: true })

    const [providersResponse, providerListResponse, agentsResponse, configResponse, sessionsResponse] = await Promise.all([
      providersPromise,
      providerListPromise,
      agentsPromise,
      configPromise,
      sessionListPromise,
    ])

    const providers = providersResponse.data!
    const providerList = providerListResponse.data!
    const agents = agentsResponse.data ?? []
    const config = configResponse.data!
    const sessions = (sessionsResponse.data ?? []).sort((a: Session, b: Session) => a.id.localeCompare(b.id))

    this.state.provider = providers.providers
    this.state.provider_default = providers.default
    this.state.provider_next = providerList
    this.state.agent = agents
    this.state.config = config
    this.state.session = sessions

    if (this.state.status !== "complete") {
      this.state.status = "partial"
      this.emit("status", { status: this.state.status })
    }

    void (async () => {
      const [
        commandResponse,
        lspResponse,
        mcpResponse,
        mcpResourceResponse,
        formatterResponse,
        sessionStatusResponse,
        providerAuthResponse,
        vcsResponse,
        pathResponse,
      ] = await Promise.all([
        sdk.command.list(),
        sdk.lsp.status(),
        sdk.mcp.status(),
        sdk.experimental.resource.list(),
        sdk.formatter.status(),
        sdk.session.status(),
        sdk.provider.auth(),
        sdk.vcs.get(),
        sdk.path.get(),
      ])

      this.state.command = commandResponse.data ?? []
      this.state.lsp = lspResponse.data ?? []
      this.state.mcp = mcpResponse.data ?? {}
      this.state.mcp_resource = mcpResourceResponse.data ?? {}
      this.state.formatter = formatterResponse.data ?? []
      this.state.session_status = sessionStatusResponse.data ?? {}
      this.state.provider_auth = providerAuthResponse.data ?? {}
      this.state.vcs = vcsResponse.data
      this.state.path = pathResponse.data!

      this.state.status = "complete"
      this.emit("status", { status: this.state.status })
    })().catch((error: unknown) => {
      const normalized = error instanceof Error ? error : new Error(String(error))
      this.emit("toast", {
        notification: { variant: "error", message: `Bootstrap failed: ${normalized.message}` },
      })
    })
  }

  processEvent(event: Event): void {
    switch (event.type) {
      case "server.instance.disposed":
        this.state.status = "loading"
        this.fullSyncedSessions.clear()
        this.derivedStatus.clear()
        this.emit("status", { status: this.state.status })
        if (this.sdk) {
          void this.bootstrap(this.sdk)
        }
        break
      case "permission.replied": {
        const requests = this.state.permission[event.properties.sessionID]
        if (!requests) break
        const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
        if (!match.found) break
        requests.splice(match.index, 1)
        break
      }

      case "permission.asked": {
        const request = event.properties
        const requests = this.state.permission[request.sessionID]
        if (!requests) {
          this.state.permission[request.sessionID] = [request]
        } else {
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            requests[match.index] = request
          } else {
            requests.splice(match.index, 0, request)
          }
        }
        this.emit("permission", { sessionID: request.sessionID, request })
        break
      }

      case "question.replied":
      case "question.rejected": {
        const requests = this.state.question[event.properties.sessionID]
        if (!requests) break
        const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
        if (!match.found) break
        requests.splice(match.index, 1)
        break
      }

      case "question.asked": {
        const request = event.properties
        const requests = this.state.question[request.sessionID]
        if (!requests) {
          this.state.question[request.sessionID] = [request]
        } else {
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            requests[match.index] = request
          } else {
            requests.splice(match.index, 0, request)
          }
        }
        this.emit("question", { sessionID: request.sessionID, request })
        break
      }

      case "todo.updated": {
        this.state.todo[event.properties.sessionID] = event.properties.todos
        this.emit("todo", { sessionID: event.properties.sessionID, todos: event.properties.todos })
        break
      }

      case "session.diff": {
        this.state.session_diff[event.properties.sessionID] = event.properties.diff
        break
      }

      case "session.created":
      case "session.updated": {
        const info = event.properties.info
        const result = Binary.search(this.state.session, info.id, (s) => s.id)
        if (result.found) {
          this.state.session[result.index] = info
        } else {
          this.state.session.splice(result.index, 0, info)
        }
        this.updateDerivedStatus(info.id)
        break
      }

      case "session.deleted": {
        const result = Binary.search(this.state.session, event.properties.info.id, (s) => s.id)
        if (result.found) {
          this.state.session.splice(result.index, 1)
        }
        this.derivedStatus.delete(event.properties.info.id)
        break
      }

      case "session.status": {
        this.state.session_status[event.properties.sessionID] = event.properties.status
        this.updateDerivedStatus(event.properties.sessionID)
        break
      }

      case "message.updated": {
        const info = event.properties.info
        const sessionID = info.sessionID
        const messages = this.state.message[sessionID] ?? []
        const result = Binary.search(messages, info.id, (m) => m.id)
        const previous = result.found ? messages[result.index] : undefined
        if (result.found) {
          messages[result.index] = info
        } else {
          messages.splice(result.index, 0, info)
        }
        this.state.message[sessionID] = messages
        while (messages.length > 100) {
          const oldest = messages.shift()
          if (oldest) {
            delete this.state.part[oldest.id]
          }
        }
        this.emitAssistantMessage(info, previous)
        this.accumulateCost(info, previous)
        this.updateDerivedStatus(sessionID)
        break
      }

      case "message.removed": {
        const messages = this.state.message[event.properties.sessionID]
        if (!messages) break
        const result = Binary.search(messages, event.properties.messageID, (m) => m.id)
        if (result.found) {
          const removed = messages.splice(result.index, 1)[0]
          if (removed) delete this.state.part[removed.id]
        }
        this.updateDerivedStatus(event.properties.sessionID)
        break
      }

      case "message.part.updated": {
        const part = event.properties.part
        const parts = this.state.part[part.messageID] ?? []
        const result = Binary.search(parts, part.id, (p) => p.id)
        if (result.found) {
          parts[result.index] = part
        } else {
          parts.splice(result.index, 0, part)
        }
        this.state.part[part.messageID] = parts
        this.emitAssistantMessageFromPart(part.sessionID, part.messageID)
        break
      }

      case "message.part.delta": {
        const parts = this.state.part[event.properties.messageID]
        if (!parts) break
        const result = Binary.search(parts, event.properties.partID, (p) => p.id)
        if (!result.found) break
        const part = parts[result.index]
        const field = event.properties.field
        const record = part as Record<string, unknown>
        const current = record[field]
        if (typeof current === "string") {
          record[field] = current + event.properties.delta
        } else if (current === undefined) {
          record[field] = event.properties.delta
        }
        this.emitAssistantMessageFromPart(event.properties.sessionID, event.properties.messageID)
        break
      }

      case "message.part.removed": {
        const parts = this.state.part[event.properties.messageID]
        if (!parts) break
        const result = Binary.search(parts, event.properties.partID, (p) => p.id)
        if (result.found) {
          parts.splice(result.index, 1)
        }
        this.emitAssistantMessageFromPart(event.properties.sessionID, event.properties.messageID)
        break
      }

      case "lsp.updated": {
        if (!this.sdk) break
        void (async () => {
          const response = await this.sdk!.lsp.status()
          this.state.lsp = response.data ?? []
        })().catch((error: unknown) => {
          const normalized = error instanceof Error ? error : new Error(String(error))
          this.emit("toast", {
            notification: { variant: "error", message: `LSP status refresh failed: ${normalized.message}` },
          })
        })
        break
      }

      case "vcs.branch.updated": {
        if (event.properties.branch) {
          this.state.vcs = { branch: event.properties.branch }
        } else {
          this.state.vcs = undefined
        }
        break
      }

      case "tui.toast.show": {
        this.emit("toast", {
          notification: {
            variant: event.properties.variant,
            message: event.properties.message,
            duration: event.properties.duration,
          },
        })
        break
      }

      case "session.error": {
        if (!event.properties.sessionID) break
        const description = this.describeSessionError(event.properties.error)
        this.emit("sessionError", {
          sessionID: event.properties.sessionID,
          error: new Error(description),
        })
        break
      }

      default:
        break
    }
  }

  readonly session = {
    get: (sessionID: string) => this.getSession(sessionID),
    status: (sessionID: string) => this.getSessionStatus(sessionID),
    sync: async (sdk: OpencodeClient, sessionID: string) => this.syncSession(sdk, sessionID),
  }

  private getSession(sessionID: string): Session | undefined {
    const match = Binary.search(this.state.session, sessionID, (s) => s.id)
    if (match.found) return this.state.session[match.index]
    return undefined
  }

  private getSessionStatus(sessionID: string): DerivedSessionStatus {
    const session = this.getSession(sessionID)
    if (!session) return "idle"
    if (session.time.compacting) return "compacting"
    const messages = this.state.message[sessionID] ?? []
    const last = messages.at(-1)
    if (!last) return "idle"
    if (last.role === "user") return "working"
    return last.time.completed ? "idle" : "working"
  }

  private accumulateCost(current: Message, previous?: Message): void {
    if (current.role !== "assistant") return
    const msg = current as Record<string, unknown>
    const cost = typeof msg.cost === "number" ? msg.cost : 0
    const tokens = msg.tokens as { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } } | undefined
    if (cost === 0 && !tokens) return

    const sessionID = current.sessionID
    const prevMsg = previous as Record<string, unknown> | undefined
    const prevCost = typeof prevMsg?.cost === "number" ? prevMsg.cost : 0

    const costDelta = cost - prevCost
    if (costDelta > 0) {
      this.state.session_cost[sessionID] = (this.state.session_cost[sessionID] ?? 0) + costDelta
    }

    if (tokens) {
      const existing = this.state.session_tokens[sessionID] ?? { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
      const prevTokens = (prevMsg?.tokens as typeof tokens) ?? {}
      const delta = (curr: number | undefined, prev: number | undefined) => Math.max(0, (curr ?? 0) - (prev ?? 0))
      existing.input += delta(tokens.input, prevTokens.input)
      existing.output += delta(tokens.output, prevTokens.output)
      existing.reasoning += delta(tokens.reasoning, prevTokens.reasoning)
      existing.cacheRead += delta(tokens.cache?.read, prevTokens.cache?.read)
      existing.cacheWrite += delta(tokens.cache?.write, prevTokens.cache?.write)
      this.state.session_tokens[sessionID] = existing
    }

    this.emit("sessionCost", {
      sessionID,
      cost: this.state.session_cost[sessionID] ?? 0,
      tokens: this.state.session_tokens[sessionID] ?? { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    })
  }

  private updateDerivedStatus(sessionID: string): void {
    const next = this.getSessionStatus(sessionID)
    const previous = this.derivedStatus.get(sessionID)
    if (previous === next) return
    this.derivedStatus.set(sessionID, next)
    this.emit("sessionStatus", { sessionID, status: next })
  }

  private emitAssistantMessage(current: Message, previous?: Message): void {
    if (current.role !== "assistant") return
    const parts = this.state.part[current.id] ?? []
    this.emit("assistantMessage", { sessionID: current.sessionID, message: current, parts })
    const wasComplete = previous?.role === "assistant" && Boolean(previous.time.completed)
    if (current.time.completed && !wasComplete) {
      this.emit("assistantMessageComplete", { sessionID: current.sessionID, message: current, parts })
    }
  }

  private emitAssistantMessageFromPart(sessionID: string, messageID: string): void {
    const message = this.getMessage(sessionID, messageID)
    if (!message || message.role !== "assistant") return
    const parts = this.state.part[messageID] ?? []
    this.emit("assistantMessage", { sessionID, message, parts })
    if (message.time.completed) {
      this.emit("assistantMessageComplete", { sessionID, message, parts })
    }
  }

  private getMessage(sessionID: string, messageID: string): Message | undefined {
    const messages = this.state.message[sessionID]
    if (!messages) return undefined
    const match = Binary.search(messages, messageID, (m) => m.id)
    if (!match.found) return undefined
    return messages[match.index]
  }

  private async syncSession(sdk: OpencodeClient, sessionID: string): Promise<void> {
    if (this.fullSyncedSessions.has(sessionID)) return
    const [session, messages, todo, diff] = await Promise.all([
      sdk.session.get({ sessionID }, { throwOnError: true }),
      sdk.session.messages({ sessionID }),
      sdk.session.todo({ sessionID }),
      sdk.session.diff({ sessionID }),
    ])

    const match = Binary.search(this.state.session, sessionID, (s) => s.id)
    if (match.found) this.state.session[match.index] = session.data!
    if (!match.found) this.state.session.splice(match.index, 0, session.data!)
    this.state.todo[sessionID] = todo.data ?? []
    type SessionMessage = { info: Message; parts: Part[] }
    const allMessages = (messages.data ?? []) as SessionMessage[]

    let totalCost = 0
    const tokenTotals = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
    for (const message of allMessages) {
      const msg = message.info as Record<string, unknown>
      if (msg.role === "assistant") {
        const cost = typeof msg.cost === "number" ? msg.cost : 0
        totalCost += cost
        const tokens = msg.tokens as { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } } | undefined
        if (tokens) {
          tokenTotals.input += tokens.input ?? 0
          tokenTotals.output += tokens.output ?? 0
          tokenTotals.reasoning += tokens.reasoning ?? 0
          tokenTotals.cacheRead += tokens.cache?.read ?? 0
          tokenTotals.cacheWrite += tokens.cache?.write ?? 0
        }
      }
    }
    this.state.session_cost[sessionID] = totalCost
    this.state.session_tokens[sessionID] = { ...tokenTotals }

    const recentMessages = allMessages.slice(-100)
    this.state.message[sessionID] = recentMessages.map((message) => message.info)
    for (const key of Object.keys(this.state.part)) {
      const belongsToSession = recentMessages.some((m) => m.info.id === key)
      if (!belongsToSession && this.state.message[sessionID]?.every((m) => m.id !== key)) {
        delete this.state.part[key]
      }
    }
    for (const message of recentMessages) {
      this.state.part[message.info.id] = message.parts
    }
    this.state.session_diff[sessionID] = diff.data ?? []
    this.fullSyncedSessions.add(sessionID)
    this.updateDerivedStatus(sessionID)
  }

  private describeSessionError(error: unknown): string {
    if (!error) return "Session error"
    if (typeof error === "string") return error
    if (typeof error === "object" && error && "data" in error) {
      const data = (error as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    return "Session error"
  }
}
