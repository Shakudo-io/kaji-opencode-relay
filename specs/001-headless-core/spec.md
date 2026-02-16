# Specification: OpenCode Headless Core

**Feature ID**: opencode-headless-001-headless-core  
**Status**: Draft  
**Created**: 2026-02-16  
**Priority**: P1 — Foundation for all channel adapters

---

## Overview

Extract the non-rendering core of the OpenCode TUI into a standalone TypeScript package (`opencode-headless`) that any channel adapter can use to drive OpenCode sessions. The package consumes the OpenCode server's HTTP API and SSE event stream — exactly like the TUI does — but without any terminal, SolidJS, or rendering dependencies.

This is the foundation layer. Adapters for Mattermost, Slack, Copilot, email, voice, and WhatsApp will be built on top of this package.

---

## Clarifications

### Session 2026-02-16
- Q: Should the SyncStore enforce the TUI's 100-message-per-session cap? → A: Yes, keep the 100-message cap. Oldest messages evicted. Adapters fetch full history from server if needed.
- Q: What should HeadlessClient do when bootstrap fails? → A: Emit error event + allow manual retry. Client stays alive, exposes `bootstrap()` for retry. Adapter decides recovery strategy.
- Q: Should the package include structured logging? → A: Yes, pluggable logger interface. Accept optional `{ debug, info, warn, error }` in config. Default: no-op.
- Q: What happens when an adapter throws during permission/question handling? → A: Auto-reject the permission + log error. Prevents blocking OpenCode session.

---

## User Stories

### US1: Connect to OpenCode Server [P1]
**As a** channel adapter developer  
**I want to** create a headless client that connects to an OpenCode server  
**So that** I can send prompts and receive responses without a terminal

**Acceptance Scenarios:**
- Given an OpenCode server URL, the client connects and receives the `server.connected` SSE event
- Given a server behind basic auth, the client authenticates with username/password
- Given a custom fetch function (for in-process RPC), the client uses it instead of HTTP
- Given a custom EventSource (for non-SSE transports), the client uses it instead of SSE
- When the SSE connection drops, the client automatically reconnects with backoff
- When `disconnect()` is called, the SSE subscription is cleanly terminated

### US2: Reactive State Store [P1]
**As a** channel adapter developer  
**I want to** subscribe to a normalized state store that tracks all OpenCode state  
**So that** I can react to session changes, new messages, permissions, and questions

**Acceptance Scenarios:**
- After connecting, the store bootstraps by fetching providers, agents, config, and session list
- When a `session.updated` event arrives, the store updates the session in-place
- When `message.updated` / `message.part.updated` / `message.part.delta` events arrive, messages and parts are inserted/updated using binary search (sorted by ID)
- When `permission.asked` arrives, it appears in `store.permissions(sessionID)`
- When `permission.replied` arrives, the permission is removed from the store
- When `question.asked` / `question.replied` / `question.rejected` arrives, questions are added/removed
- When `todo.updated` arrives, todos are replaced for that session
- When `session.deleted` arrives, the session is removed
- The store exposes typed accessors: `sessions`, `messages(id)`, `parts(id)`, `permissions(id)`, `questions(id)`, `todos(id)`, `providers`, `agents`, `config`, `mcpStatus`, `lspStatus`, `vcsInfo`
- The store provides `session.status(id)` returning `idle | working | compacting`
- The store emits change events that adapters can subscribe to (no SolidJS dependency)

### US3: Session Operations [P1]
**As a** channel adapter developer  
**I want to** perform session operations (create, prompt, abort, fork, etc.)  
**So that** I can drive OpenCode sessions from any channel

**Acceptance Scenarios:**
- `createSession()` creates a new session and returns the session object
- `prompt(sessionID, text, options?)` sends a user message with optional model/agent override
- `abort(sessionID)` cancels the current operation
- `fork(sessionID)` creates a forked copy
- `summarize(sessionID, model)` triggers session compaction
- `revert(sessionID, messageID)` reverts to a specific message
- `unrevert(sessionID)` restores reverted messages
- `share(sessionID)` / `unshare(sessionID)` manages sharing
- `deleteSession(sessionID)` deletes a session
- `replyPermission(requestID, reply)` sends once/always/reject
- `replyQuestion(requestID, answers)` sends structured answers
- `rejectQuestion(requestID)` dismisses a question
- All operations return typed results from `@opencode-ai/sdk/v2`

### US4: Channel Adapter Interface [P1]
**As a** channel adapter developer  
**I want to** implement a well-defined TypeScript interface  
**So that** my adapter integrates cleanly with the headless core

**Acceptance Scenarios:**
- The package exports a `ChannelAdapter` interface with methods for all adapter responsibilities
- The package exports Zod schemas for all data types flowing to/from adapters
- Adapter methods include:
  - `onAssistantMessage(sessionID, message, parts)` — streaming message updates
  - `onAssistantMessageComplete(sessionID, message, parts)` — response finished
  - `onPermissionRequest(sessionID, request)` → returns `{ reply: "once" | "always" | "reject", message?: string }`
  - `onQuestionRequest(sessionID, request)` → returns `{ answers: string[][] } | { rejected: true }`
  - `onSessionStatus(sessionID, status)` — idle/working/compacting
  - `onTodoUpdate(sessionID, todos)` — todo list changes
  - `onSessionError(sessionID, error)` — errors
  - `onToast(notification)` — notifications
  - Note: User input originates from the channel and flows through the adapter to `HeadlessClient.prompt()`. The adapter interface does not include a `sendPrompt` method — adapters call client operations directly.
- The interface includes a `capabilities` declaration:
  ```
  { streaming, richFormatting, interactiveButtons, fileUpload, diffViewer }
  ```
- The package exports a `HeadlessRouter` class that connects a `HeadlessClient` + `SyncStore` to one or more `ChannelAdapter` instances, dispatching events to the right adapter

### US5: Lifecycle Management [P2]
**As a** channel adapter developer  
**I want to** manage the full lifecycle of a headless client  
**So that** I can cleanly start, stop, and restart connections

**Acceptance Scenarios:**
- `HeadlessClient.connect(config)` establishes connection and starts bootstrapping
- `HeadlessClient.disconnect()` cleanly shuts down SSE, clears store, releases resources
- `HeadlessClient.isConnected` returns connection status
- `HeadlessClient.on("connected" | "disconnected" | "error", handler)` for lifecycle events
- The client emits `reconnecting` and `reconnected` events during automatic reconnection
- Multiple adapters can be registered/unregistered dynamically

---

## Functional Requirements

### FR1: SDK Client Wrapper
- Wrap `createOpencodeClient` from `@opencode-ai/sdk/v2`
- Accept configuration: `{ url, directory?, fetch?, headers?, events?, logger? }`
- Accept optional pluggable logger: `{ debug, info, warn, error }` — defaults to no-op. Used for SSE events, reconnection attempts, store updates, and error conditions.
- Manage SSE subscription lifecycle with automatic reconnection
- Batch events at configurable interval (default 16ms, matching TUI behavior)
- Expose the raw SDK client for advanced use cases
- On bootstrap failure: emit `"error"` event, stay alive, expose `bootstrap()` for manual retry. Do not auto-exit — adapter decides recovery strategy.

### FR2: Framework-Agnostic State Store
- Implement the SyncProvider event→state mapping without SolidJS dependency
- Use TypeScript `EventEmitter` (or similar) for change notification
- Maintain normalized data structures with binary search for efficient updates
- Support the full set of 18+ OpenCode event types
- Enforce 100-message-per-session cap: when exceeded, evict oldest message and its parts (matching TUI behavior). Adapters needing full history should fetch from the server on demand.
- Bootstrap sequence: fetch providers → agents → config → session list (blocking), then non-blocking: commands, LSP status, MCP status, resources, formatters, session statuses, provider auth, VCS info, paths
- Provide `subscribe(path, callback)` for granular change listening

### FR3: Adapter Dispatch
- `HeadlessRouter` maps sessions to adapters
- When a message event arrives, route to the adapter that owns that session
- When a permission/question event arrives, route to the correct adapter and wait for response
- If the adapter's permission/question handler throws an error (crashes), auto-reject the permission and log the error via the pluggable logger. This prevents a broken adapter from blocking the OpenCode session indefinitely.
- Support multiple adapters simultaneously (e.g., Mattermost + Slack)
- If no adapter claims a session, events are logged but not lost (store still has them)

### FR4: Type Exports
- Re-export all relevant types from `@opencode-ai/sdk/v2`: Session, Message, Part, PermissionRequest, QuestionRequest, Todo, Provider, Agent, Config, etc.
- Export Zod schemas for adapter input/output validation
- Export utility types for common patterns (e.g., `SessionStatus`, `AdapterReply`)

### FR5: Zero UI Dependencies
- No dependency on SolidJS, @opentui/solid, @opentui/core, Ink, or any rendering library
- No dependency on Node.js-specific APIs that prevent Bun/Deno compatibility (except where `@opencode-ai/sdk` already depends on them)
- Package size should be minimal — only the SDK, Zod, and an EventEmitter

---

## Non-Functional Requirements

### NFR1: Performance
- Event processing latency should not exceed the TUI's 16ms batching window
- State store updates should be O(log n) via binary search (matching TUI implementation)
- Memory usage should scale linearly with number of sessions/messages tracked

### NFR2: Reliability
- SSE reconnection with exponential backoff (matching TUI behavior)
- Graceful handling of server restarts (re-bootstrap on `server.instance.disposed`)
- No data loss during reconnection — events are queued during reconnect

### NFR3: Developer Experience
- Full TypeScript types with JSDoc documentation
- Published as npm package: `opencode-headless`
- Clear examples in README showing basic adapter creation
- Exported types should be sufficient to build an adapter without reading source

---

## Scope Boundaries

### In Scope
- SDK client wrapper with connection management
- Reactive state store (event→state mapping, change events)
- Session operation methods
- Channel adapter TypeScript interface + Zod schemas
- HeadlessRouter for adapter dispatch
- Type re-exports from @opencode-ai/sdk/v2
- Package setup (tsconfig, package.json, build)

### Out of Scope
- Any concrete adapter implementation (Mattermost, Slack, etc.) — deferred to separate packages
- Message formatting/rendering — adapter responsibility
- Channel-specific persistence (thread mapping, etc.) — adapter responsibility
- Response buffering/chunking — adapter responsibility
- User authentication/authorization — adapter responsibility
- UI of any kind

---

## Key Entities

| Entity | Description |
|--------|-------------|
| `HeadlessClient` | Main entry point — wraps SDK client, manages SSE, exposes operations |
| `SyncStore` | Normalized state store with event→state mapping and change events |
| `HeadlessRouter` | Dispatches store events to registered ChannelAdapter instances |
| `ChannelAdapter` | Interface that concrete adapters implement |
| `AdapterCapabilities` | Declares what a channel supports (streaming, buttons, files, etc.) |

---

## Assumptions

- The OpenCode server API and SSE event format are stable (based on `@opencode-ai/sdk/v2`)
- Binary search by ID is the correct approach (IDs are lexicographically sortable, matching TUI)
- The 16ms event batching interval from the TUI is appropriate for headless use
- `@opencode-ai/sdk/v2` will remain the canonical client library
- Channel adapters will handle their own persistence, formatting, and buffering

---

## Dependencies

- `@opencode-ai/sdk/v2` — HTTP client, types, SSE subscription
- `zod` — Schema validation for adapter interfaces
- A running OpenCode server instance to connect to

---

## Success Criteria

- A developer can `npm install opencode-headless`, connect to an OpenCode server, and subscribe to state changes in under 10 lines of code
- The state store correctly handles all 18+ event types from the OpenCode server
- A minimal adapter implementing the `ChannelAdapter` interface can send prompts and receive responses
- The package has zero rendering/UI dependencies
- The package works in Node.js 18+, Bun, and Deno
- All types and schemas are exported for adapter authors
