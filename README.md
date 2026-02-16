# kaji-opencode-relay

Universal relay for [OpenCode](https://github.com/opencode-ai/opencode) — route AI coding sessions to any channel (Mattermost, Slack, Copilot, email, voice).

The relay connects to a running OpenCode server via HTTP + SSE (the same protocol the TUI uses), maintains a synced state store, and dispatches events to channel adapters.

## Install

```bash
bun add kaji-opencode-relay
# peer dependency
bun add @opencode-ai/sdk
```

## Quick Start

```typescript
import { createHeadless } from "kaji-opencode-relay"

// 1. Define your adapter
const adapter = {
  id: "my-adapter",
  channel: "my-channel",
  capabilities: { streaming: true, richFormatting: true, interactiveButtons: false, fileUpload: false, diffViewer: false, codeBlocks: true },

  async onAssistantMessage(sessionID, message, parts) {
    for (const part of parts) {
      if (part.type === "text") console.log(part.text)
      if (part.type === "reasoning") console.log("[thinking]", part.text)
      if (part.type === "file") console.log("[file]", part.filename, part.mime)
      if (part.type === "tool") console.log("[tool]", part.tool, part.state?.status)
    }
  },
  async onAssistantMessageComplete(sessionID, message, parts) { },
  async onPermissionRequest(sessionID, request) { return { reply: "once" } },
  async onQuestionRequest(sessionID, request) { return { answers: [[]] } },
  onSessionStatus(sessionID, status) { },
  onTodoUpdate(sessionID, todos) { },
  onSessionError(sessionID, error) { },
  onToast(notification) { },
}

// 2. Connect to OpenCode
const { client, store, router } = createHeadless({
  client: { url: "http://localhost:4096" },
  adapters: [adapter],
})

await client.connect()
await client.bootstrap(store)

// 3. Send a prompt
const session = await client.createSession()
await client.prompt(session.id, "List all TypeScript files")
```

## Architecture

```
OpenCode Server (HTTP + SSE)
       │
       ▼
 HeadlessClient ─── events ──→ SyncStore ──→ HeadlessRouter
       │                                          │
       │                              ┌───────────┼───────────┐
       ▼                              ▼           ▼           ▼
  SDK operations              Mattermost    Slack       Voice
  (prompt, abort,              Adapter     Adapter     Adapter
   permission reply)
```

**HeadlessClient** — Wraps `@opencode-ai/sdk`. Manages SSE connection with auto-reconnect. Batches events at 16ms (matching TUI). Exposes session operations.

**SyncStore** — Normalized state store ported from the TUI's `sync.tsx`. Handles all 18+ SSE event types. Binary search for O(log n) updates. 100-message cap per session.

**HeadlessRouter** — Dispatches store events to registered adapters by session. Handles permission/question round-trips with configurable timeout (default 5 min). Auto-rejects on adapter crash.

## ChannelAdapter Interface

```typescript
interface ChannelAdapter {
  readonly id: string
  readonly channel: string
  readonly capabilities: AdapterCapabilities

  onAssistantMessage(sessionID: string, message: Message, parts: Part[]): Promise<void>
  onAssistantMessageComplete(sessionID: string, message: Message, parts: Part[]): Promise<void>
  onPermissionRequest(sessionID: string, request: PermissionRequest): Promise<PermissionReply>
  onQuestionRequest(sessionID: string, request: QuestionRequest): Promise<QuestionReply>
  onSessionStatus(sessionID: string, status: DerivedSessionStatus): void
  onTodoUpdate(sessionID: string, todos: Todo[]): void
  onSessionError(sessionID: string, error: Error): void
  onToast(notification: ToastNotification): void
}
```

## File Attachments

```typescript
import { createFilePartInput, createFilePartInputFromBuffer } from "kaji-opencode-relay"

// From disk (async, 20MB limit)
const image = await createFilePartInput("./screenshot.png")
await client.promptWithFiles(sessionID, "What's in this image?", [image])

// From buffer
const text = createFilePartInputFromBuffer(Buffer.from("hello"), "note.txt", "text/plain")
await client.promptWithFiles(sessionID, "Read this file", [text])
```

## Model Override

```typescript
await client.prompt(sessionID, "What is 17 * 23?", {
  model: { providerID: "openrouter", modelID: "z-ai/glm-5" }
})
```

## Debug Adapter

A built-in CLI for testing the relay against a live OpenCode server:

```bash
# Observe all events
bun run bin/debug.ts --url http://localhost:4096

# Interactive mode — respond to permissions/questions from stdin
bun run bin/debug.ts --url http://localhost:4096 --interactive

# NDJSON output for piping
bun run bin/debug.ts --url http://localhost:4096 --json | jq .

# Attach files
> /attach ./image.png
> Describe what you see in this image
```

## Part Types

The relay handles all OpenCode part types:

| Type | Description |
|------|------------|
| `text` | Assistant text response (field: `text`) |
| `reasoning` | Thinking/reasoning content (field: `text`) |
| `tool` | Tool call with state (pending/running/completed/error) |
| `file` | File attachment (field: `url` with data URI, `mime`, `filename`) |
| `step-start` | Step boundary start |
| `step-finish` | Step boundary end |
| `patch` | File modification record (field: `files`, `hash`) |

## Package Exports

| Export | Contents |
|--------|----------|
| `kaji-opencode-relay` | HeadlessClient, SyncStore, HeadlessRouter, createHeadless |
| `kaji-opencode-relay/types` | All SDK type re-exports + custom types |
| `kaji-opencode-relay/adapter` | ChannelAdapter interface |
| `kaji-opencode-relay/store` | SyncStore standalone |
| `kaji-opencode-relay/schemas` | Zod schemas for adapter I/O |
| `kaji-opencode-relay/debug` | DebugAdapter for testing |

## Testing

```bash
# Unit tests
bun test tests/binary.test.ts tests/events.test.ts tests/store.test.ts tests/router.test.ts tests/debug-adapter.test.ts tests/files.test.ts tests/client.test.ts

# Live tests (requires running OpenCode server)
LIVE_TEST_URL=http://localhost:4096 bun test tests/live-integration.test.ts --timeout 60000
LIVE_TEST_URL=http://localhost:4096 bun test tests/live-interactive.test.ts --timeout 300000
LIVE_TEST_URL=http://localhost:4096 bun test tests/live-features.test.ts --timeout 180000
```

## License

MIT
