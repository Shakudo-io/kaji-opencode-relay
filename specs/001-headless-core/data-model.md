# Data Model: OpenCode Headless Core

**Feature ID**: kaji-opencode-relay-001-headless-core  
**Created**: 2026-02-16

---

## Core Entities

### SyncStore State Shape

The central state object, ported from the TUI's `sync.tsx`:

```typescript
interface StoreState {
  // Bootstrap status
  status: "loading" | "partial" | "complete"
  
  // Providers & auth
  provider: Provider[]                                    // sorted by id
  provider_default: Record<string, string>                // providerID → default modelID
  provider_next: ProviderListResponse                     // { all, default, connected }
  provider_auth: Record<string, ProviderAuthMethod[]>     // providerID → auth methods
  
  // Agents
  agent: Agent[]                                          // sorted by name
  
  // Commands
  command: Command[]
  
  // Sessions
  session: Session[]                                      // sorted by id
  session_status: Record<string, SessionStatus>           // sessionID → status
  session_diff: Record<string, FileDiff[]>                // sessionID → file diffs
  
  // Messages (per session)
  message: Record<string, Message[]>                      // sessionID → messages (sorted by id, max 100)
  part: Record<string, Part[]>                            // messageID → parts (sorted by id)
  
  // Interactive prompts
  permission: Record<string, PermissionRequest[]>         // sessionID → pending permissions
  question: Record<string, QuestionRequest[]>             // sessionID → pending questions
  
  // Todos
  todo: Record<string, Todo[]>                            // sessionID → todos
  
  // Infrastructure status
  lsp: LspStatus[]
  mcp: Record<string, McpStatus>
  mcp_resource: Record<string, McpResource>
  formatter: FormatterStatus[]
  
  // Environment
  vcs: VcsInfo | undefined
  path: { state: string; config: string; worktree: string; directory: string }
  
  // Config
  config: Config
}
```

### HeadlessClient Config

```typescript
interface HeadlessClientConfig {
  url: string                              // OpenCode server URL
  directory?: string                       // Working directory
  fetch?: typeof fetch                     // Custom fetch (for in-process RPC)
  headers?: Record<string, string>         // Extra headers (auth, etc.)
  events?: EventSource                     // Custom event source (for non-SSE)
  batchInterval?: number                   // Event batch interval (default: 16ms)
  logger?: Logger                          // Pluggable logger (default: no-op)
}

interface Logger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}
```

### ChannelAdapter Interface

```typescript
interface ChannelAdapter {
  readonly id: string
  readonly channel: string
  readonly capabilities: AdapterCapabilities
  
  // Lifecycle
  initialize?(): Promise<void>
  shutdown?(): Promise<void>
  
  // Message streaming
  onAssistantMessage(sessionID: string, message: Message, parts: Part[]): Promise<void>
  onAssistantMessageComplete(sessionID: string, message: Message, parts: Part[]): Promise<void>
  
  // Interactive prompts (blocking — router awaits response)
  onPermissionRequest(sessionID: string, request: PermissionRequest): Promise<PermissionReply>
  onQuestionRequest(sessionID: string, request: QuestionRequest): Promise<QuestionReply>
  
  // Status updates
  onSessionStatus(sessionID: string, status: DerivedSessionStatus): void
  onTodoUpdate(sessionID: string, todos: Todo[]): void
  onSessionError(sessionID: string, error: Error): void
  onToast(notification: ToastNotification): void
}

interface AdapterCapabilities {
  streaming: boolean          // Can update messages in-place?
  richFormatting: boolean     // Markdown/HTML support?
  interactiveButtons: boolean // Can render action buttons?
  fileUpload: boolean         // Can accept file attachments?
  diffViewer: boolean         // Can render diffs?
  codeBlocks: boolean         // Can render syntax-highlighted code?
}

type DerivedSessionStatus = "idle" | "working" | "compacting"

interface PermissionReply {
  reply: "once" | "always" | "reject"
  message?: string                        // Optional reject reason
}

type QuestionReply =
  | { answers: string[][] }               // Answered
  | { rejected: true }                    // Dismissed

interface ToastNotification {
  variant: "error" | "warning" | "success" | "info"
  message: string
  duration?: number
}
```

### HeadlessRouter

```typescript
interface HeadlessRouterConfig {
  client: HeadlessClient
  store: SyncStore
  defaultAdapter?: string                  // Adapter ID for unclaimed sessions
}
```

---

## Event Types (SSE → Store)

All events received from the OpenCode server SSE stream:

| Event | Store Update | Adapter Callback |
|-------|-------------|-----------------|
| `server.connected` | (none) | Lifecycle event |
| `server.instance.disposed` | Re-bootstrap | (none) |
| `session.updated` | Upsert in `session[]` | (none) |
| `session.deleted` | Remove from `session[]` | (none) |
| `session.status` | Update `session_status[id]` | `onSessionStatus()` |
| `session.diff` | Update `session_diff[id]` | (none) |
| `message.updated` | Upsert in `message[sessionID]` | `onAssistantMessage()` |
| `message.removed` | Remove from `message[sessionID]` | (none) |
| `message.part.updated` | Upsert in `part[messageID]` | `onAssistantMessage()` |
| `message.part.delta` | Append delta to field on part | `onAssistantMessage()` |
| `message.part.removed` | Remove from `part[messageID]` | (none) |
| `permission.asked` | Insert in `permission[sessionID]` | `onPermissionRequest()` |
| `permission.replied` | Remove from `permission[sessionID]` | (none) |
| `question.asked` | Insert in `question[sessionID]` | `onQuestionRequest()` |
| `question.replied` | Remove from `question[sessionID]` | (none) |
| `question.rejected` | Remove from `question[sessionID]` | (none) |
| `todo.updated` | Replace `todo[sessionID]` | `onTodoUpdate()` |
| `lsp.updated` | Re-fetch LSP status | (none) |
| `vcs.branch.updated` | Update `vcs.branch` | (none) |

---

## Store Change Events

Emitted by `SyncStore` for subscriber notification:

| Event | Payload |
|-------|---------|
| `status` | `{ status: "loading" \| "partial" \| "complete" }` |
| `session` | `{ sessionID: string, session: Session }` |
| `session.deleted` | `{ sessionID: string }` |
| `session.status` | `{ sessionID: string, status: DerivedSessionStatus }` |
| `message` | `{ sessionID: string, messageID: string, message: Message }` |
| `message.removed` | `{ sessionID: string, messageID: string }` |
| `part` | `{ messageID: string, partID: string, part: Part }` |
| `part.delta` | `{ messageID: string, partID: string, field: string, delta: string }` |
| `part.removed` | `{ messageID: string, partID: string }` |
| `permission` | `{ sessionID: string, request: PermissionRequest }` |
| `permission.removed` | `{ sessionID: string, requestID: string }` |
| `question` | `{ sessionID: string, request: QuestionRequest }` |
| `question.removed` | `{ sessionID: string, requestID: string }` |
| `todo` | `{ sessionID: string, todos: Todo[] }` |

---

## Binary Search Invariant

All sorted arrays use **lexicographic ID comparison**:
- `session[]` sorted by `session.id`
- `message[sessionID][]` sorted by `message.id`
- `part[messageID][]` sorted by `part.id`
- `permission[sessionID][]` sorted by `request.id`
- `question[sessionID][]` sorted by `request.id`

The `Binary.search()` function returns `{ found: boolean, index: number }` where `index` is the insertion point if not found.
