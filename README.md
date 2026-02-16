# kaji-opencode-relay

Universal relay for [OpenCode](https://github.com/opencode-ai/opencode) — route AI coding sessions to any channel (Mattermost, Slack, MS Teams/Copilot, email, WhatsApp, voice).

The relay connects to a running OpenCode server via HTTP + SSE (the same protocol the TUI uses), maintains a synced state store, and dispatches events to channel adapters.

## Install

```bash
bun add kaji-opencode-relay
bun add @opencode-ai/sdk   # peer dependency
```

## Architecture

```
OpenCode Server (HTTP + SSE)
       │
       ▼
 HeadlessClient ─── SSE events ──→ SyncStore ──→ HeadlessRouter
       │                               │               │
       │                          cost/token       ┌────┼────┐
       ▼                          accumulators     ▼    ▼    ▼
  SDK operations                                Adapter Adapter Adapter
  (prompt, abort,                              (MM)   (Slack) (Voice)
   permission reply,
   file attachments)
```

**HeadlessClient** — Wraps `@opencode-ai/sdk`. Manages SSE connection with auto-reconnect and 16ms event batching (matching TUI). Exposes all session operations.

**SyncStore** — Normalized state store ported from the TUI's `sync.tsx`. Handles all 18+ SSE event types. Binary search for O(log n) updates. 100-message cap per session (most recent kept). Running cost/token accumulators that survive message eviction.

**HeadlessRouter** — Dispatches store events to registered adapters by session. Handles permission/question round-trips with configurable timeout (default 5 min). Auto-rejects on adapter crash to prevent blocking.

## Quick Start

```typescript
import { createHeadless } from "kaji-opencode-relay"
import type { ChannelAdapter } from "kaji-opencode-relay/adapter"

const adapter: ChannelAdapter = {
  id: "my-adapter",
  channel: "my-channel",
  capabilities: {
    streaming: true,
    richFormatting: true,
    interactiveButtons: false,
    fileUpload: false,
    diffViewer: false,
    codeBlocks: true,
  },

  async onAssistantMessage(sessionID, message, parts) {
    if (message.error) {
      console.error(`Error: ${message.error.name}: ${message.error.data?.message}`)
    }
    for (const part of parts) {
      switch (part.type) {
        case "text":       console.log(part.text); break
        case "reasoning":  console.log("[thinking]", part.text); break
        case "tool":       console.log(`[${part.tool}] ${part.state?.status}`); break
        case "file":       console.log(`[file] ${part.filename} (${part.mime})`); break
        case "subtask":    console.log(`[subtask] ${part.agent}: ${part.description}`); break
        case "step-finish": console.log(`[step] $${part.cost} | ${part.tokens?.input} in / ${part.tokens?.output} out`); break
      }
    }
  },
  async onAssistantMessageComplete(sessionID, message, parts) {
    console.log(`Done: $${message.cost} | ${message.providerID}/${message.modelID}`)
  },
  async onPermissionRequest(sessionID, request) { return { reply: "once" } },
  async onQuestionRequest(sessionID, request) {
    return { answers: request.questions.map(q => [q.options?.[0]?.label ?? ""]) }
  },
  onSessionStatus(sessionID, status) { },
  onTodoUpdate(sessionID, todos) { },
  onSessionError(sessionID, error) { },
  onToast(notification) { },
}

const { client, store, router } = createHeadless({
  client: { url: "http://localhost:4096" },
  adapters: [adapter],
})

await client.connect()
await client.bootstrap(store)

const result = await client.createSession()
await client.prompt(result.data.id, "List all TypeScript files")
```

## Building a Channel Adapter

### Step 1: Copy the debug adapter as a template

`src/debug/adapter.ts` implements every `ChannelAdapter` method with all part types, error handling, cost/model display, and subtask rendering. Copy it and modify for your channel.

### Step 2: Handle the three interaction patterns

**1. Message streaming (output)**
```
Server → SSE → store → router → adapter.onAssistantMessage(sessionID, message, parts)
```
Called repeatedly as the LLM generates. Parts accumulate. Check `part.type`:

| Part Type | Key Fields | What to Render |
|-----------|-----------|---------------|
| `text` | `text` | LLM response text |
| `reasoning` | `text` | Model's thinking/reasoning (show if supported) |
| `tool` | `tool`, `state.status`, `state.input`, `state.output`, `state.time` | Tool execution with status |
| `file` | `url` (data URI), `mime`, `filename` | File attachment |
| `subtask` | `agent`, `description`, `model` | Task delegation metadata |
| `step-finish` | `cost`, `tokens` | Per-step cost/token breakdown |

Also check `message.error` — messages can have errors (API failures, certificate errors, etc.).

**2. Permission prompt (blocking)**
```
Server → permission.asked → router → adapter.onPermissionRequest() → router → server
```
Return `{ reply: "once" | "always" | "reject", message?: string }`. If you throw or time out, relay auto-rejects.

**3. Question prompt (blocking)**
```
Server → question.asked → router → adapter.onQuestionRequest() → router → server
```
Return `{ answers: string[][] }` or `{ rejected: true }`. Each inner array is answers for one question.

### Step 3: Cost, model, and errors on every message

Every `AssistantMessage` carries:
```typescript
message.modelID     // "claude-sonnet-4-20250514"
message.providerID  // "anthropic"
message.cost        // USD cost for this message
message.tokens      // { input, output, reasoning, cache: { read, write } }
message.error       // { name, data: { message } } or undefined
```

For session-level aggregates (survives the 100-message cap):
```typescript
store.sessionCost(sessionID)    // Running USD total across ALL messages
store.sessionTokens(sessionID)  // { input, output, reasoning, cacheRead, cacheWrite }
```

### Step 4: Subtask/subagent delegation

When the LLM delegates via the `task` tool, events arrive progressively:

1. `ToolPart` with `tool === "task"`, `state.status === "pending"` (input empty — skip rendering)
2. `state.status === "running"` — fields populate progressively:
   - Agent type: `state.metadata.agent` > `state.input.subagent_type` > `state.input.category`
   - Description: `state.title` > `state.input.description` > `state.input.prompt`
   - Child session: `state.metadata.sessionId`
3. `state.status === "completed"` — adds `state.output`, `state.time.end`

A `SubtaskPart` may also appear with `part.agent`, `part.description`, `part.model`.

### Step 5: MCP servers

Available MCP servers and their status:
```typescript
store.mcpStatus      // Record<string, McpStatus> — { status: "connected" | "failed" | "disabled", error? }
store.mcpResources   // Record<string, McpResource> — tools and resources per server
```

## Client API

### Connection
```typescript
const client = new HeadlessClient({
  url: "http://localhost:4096",
  directory?: string,           // Working directory
  fetch?: typeof fetch,         // Custom fetch for in-process RPC
  headers?: Record<string, string>,
  events?: EventSource,         // Custom event source for non-SSE
  batchInterval?: number,       // Event batch interval (default 16ms)
  logger?: Logger,              // { debug, info, warn, error } — default no-op
  createClient?: (config) => sdk, // SDK factory for testing
})
await client.connect()
await client.bootstrap(store)
client.disconnect()
client.isConnected
```

### Session Operations
```typescript
client.createSession(options?)
client.prompt(sessionID, text, options?)
client.promptWithFiles(sessionID, text, files, options?)
client.abort(sessionID)
client.fork(sessionID)
client.summarize(sessionID, providerID, modelID)
client.revert(sessionID, messageID)
client.unrevert(sessionID)
client.share(sessionID) / client.unshare(sessionID)
client.deleteSession(sessionID)
client.executeCommand(sessionID, command)
client.replyPermission(requestID, { reply, message? })
client.replyQuestion(requestID, answers)
client.rejectQuestion(requestID)
```

### File Attachments
```typescript
import { createFilePartInput, createFilePartInputFromBuffer } from "kaji-opencode-relay"
const image = await createFilePartInput("./screenshot.png")  // async, 20MB limit
const text = createFilePartInputFromBuffer(Buffer.from("data"), "file.txt", "text/plain")
await client.promptWithFiles(sessionID, "Describe this", [image, text])
```

### Events
```typescript
client.on("connected" | "disconnected" | "reconnecting" | "reconnected" | "error" | "event", handler)
```

## Store API

```typescript
store.status                        // "loading" | "partial" | "complete"
store.sessions                      // Session[]
store.providers                     // Provider[]
store.agents                        // Agent[]
store.config                        // Config
store.mcpStatus                     // Record<string, McpStatus>
store.mcpResources                  // Record<string, McpResource>
store.lspStatus                     // LspStatus[]
store.formatterStatus               // FormatterStatus[]
store.vcsInfo                       // VcsInfo | undefined
store.path                          // { home, state, config, worktree, directory }

store.messages(sessionID)           // Message[] (last 100, most recent)
store.parts(messageID)              // Part[]
store.permissions(sessionID)        // PermissionRequest[]
store.questions(sessionID)          // QuestionRequest[]
store.todos(sessionID)              // Todo[]
store.sessionCost(sessionID)        // Running USD total
store.sessionTokens(sessionID)      // { input, output, reasoning, cacheRead, cacheWrite }
store.session.status(sessionID)     // "idle" | "working" | "compacting"
store.session.get(sessionID)        // Session | undefined
store.session.sync(sdk, sessionID)  // Fetch full session data from server
store.snapshot()                    // Deep copy of entire state
store.processEvent(event)           // Process an SSE event manually

// Change events
store.on("assistantMessage" | "assistantMessageComplete" | "permission" | "question" |
         "todo" | "sessionStatus" | "sessionCost" | "sessionError" | "toast" | "status", handler)
```

## Debug Adapter

Built-in CLI for testing against a live OpenCode server:

```bash
bun run bin/debug.ts --url http://localhost:4096                    # observe all events
bun run bin/debug.ts --url http://localhost:4096 --session ses_abc  # filter to one session
bun run bin/debug.ts --url http://localhost:4096 --interactive      # manual permission/question responses
bun run bin/debug.ts --url http://localhost:4096 --json             # NDJSON for piping
bun run bin/debug.ts --url http://localhost:4096 --verbose          # include raw SSE events
```

Output:
```
[CONNECTED]    Connected to OpenCode at http://localhost:4096
[BOOTSTRAP]    Loaded 15 providers, 34 agents, 145 sessions
[MCP]          17 servers, 16 connected, 1 disabled
  ✅ websearch (connected)
  ✅ mattermost (connected)
  ⏸️ graphiti-memory (disabled)
[MODEL]        anthropic/claude-opus-4-6
[THINKING]     Let me check the project structure first...
[TOOL]         bash: ls -la src/ (running)
[TOOL]         bash: completed
[TEXT]         Here are the TypeScript files...
[SUBTASK]      🕵️ developer — "implement auth" (running) [ses_abc123]
[SUBTASK]      ✅ developer — "implement auth" (6.8s) [ses_abc123]
[STEP]         $0.01 | 456 in / 123 out / 200 cache
[COST]         $0.03 | 1.2K in / 567 out / 89 reasoning / 45 cache
[FILE]         report.txt (text/plain, 1.2KB)
[ERROR]        UnknownError: certificate verification error
[SESSION]      Total: $0.45 | 12.3K tokens
[STATUS]       ses_abc1 → idle — waiting for input
```

## Package Exports

| Export | Contents |
|--------|----------|
| `kaji-opencode-relay` | `HeadlessClient`, `SyncStore`, `HeadlessRouter`, `createHeadless`, file utils |
| `kaji-opencode-relay/types` | SDK type re-exports + `Logger`, `PermissionReply`, `QuestionReply`, `ToastNotification`, `DerivedSessionStatus`, `AdapterCapabilities` |
| `kaji-opencode-relay/adapter` | `ChannelAdapter` interface |
| `kaji-opencode-relay/store` | `SyncStore`, `TokenSummary` |
| `kaji-opencode-relay/schemas` | Zod schemas for adapter I/O validation |
| `kaji-opencode-relay/debug` | `DebugAdapter` |

## Testing

```bash
# Unit tests (40 tests)
bun test tests/binary.test.ts tests/events.test.ts tests/store.test.ts \
  tests/router.test.ts tests/debug-adapter.test.ts tests/files.test.ts tests/client.test.ts

# Live tests (requires running OpenCode server)
LIVE_TEST_URL=http://localhost:4096 bun test tests/live-integration.test.ts --timeout 60000
LIVE_TEST_URL=http://localhost:4096 bun test tests/live-interactive.test.ts --timeout 300000
LIVE_TEST_URL=http://localhost:4096 bun test tests/live-features.test.ts --timeout 180000
LIVE_TEST_URL=http://localhost:4096 bun test tests/live-cost-model-subtask.test.ts --timeout 300000
LIVE_TEST_URL=http://localhost:4096 bun test tests/live-adapter-events.test.ts --timeout 60000
```

## License

MIT
