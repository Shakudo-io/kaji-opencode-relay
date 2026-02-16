# Tasks: OpenCode Headless Core

**Feature ID**: opencode-headless-001-headless-core  
**Created**: 2026-02-16  
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

---

## Phase 1: Project Setup

- [ ] T001 [Setup] Initialize package: `package.json`, `tsconfig.json`, `.gitignore`, `LICENSE` in worktree `/root/gitrepos/opencode-headless-001-headless-core/`
  - Bun project, ESM, strict TypeScript
  - Dependencies: `@opencode-ai/sdk` (peer), `zod`
  - Dev dependencies: `bun-types`, `typescript`
  - Package exports: `.`, `./types`, `./adapter`, `./store`, `./schemas`
  - File: `package.json`, `tsconfig.json`

- [ ] T002 [Setup] Create source directory structure
  - `src/index.ts`, `src/client.ts`, `src/store.ts`, `src/router.ts`, `src/adapter.ts`, `src/schemas.ts`, `src/binary.ts`, `src/events.ts`, `src/types.ts`
  - `tests/` directory
  - File: all `src/*.ts` stubs

- [ ] T003 [Setup] Install dependencies and verify `bun build` works with empty stubs
  - File: `bun.lock`

---

## Phase 2: Foundational Utilities [US1, US2]

- [ ] T004 [P] [US2] Port `Binary.search()` and `Binary.insert()` from `@opencode-ai/util/binary`
  - Copy the 42-line binary search implementation
  - File: `src/binary.ts`

- [ ] T005 [P] [US2] Write unit tests for binary search
  - Test: sorted array insert, search found/not-found, edge cases (empty array, single element)
  - File: `tests/binary.test.ts`

- [ ] T006 [P] [US1] Create typed EventEmitter (`TypedEmitter<EventMap>`)
  - ~30 lines: `on()`, `off()`, `emit()`, `once()`, typed via generic map
  - No Node.js `events` dependency — works in Bun/Deno/browser
  - File: `src/events.ts`

- [ ] T007 [P] [US1] Write unit tests for TypedEmitter
  - Test: subscribe, emit, unsubscribe, once, multiple listeners, type safety
  - File: `tests/events.test.ts`

---

## Phase 3: SDK Client Wrapper [US1, US5]

- [ ] T008 [US1] Implement `HeadlessClient` class
  - Constructor accepts `HeadlessClientConfig` (url, directory, fetch, headers, events, batchInterval, logger)
  - Accept optional pluggable `Logger` interface (debug/info/warn/error). Default: no-op. Define Logger type in `src/types.ts`.
  - `connect()` method: creates SDK client via `createOpencodeClient()`, starts SSE subscription loop
  - SSE loop: iterate `sdk.event.subscribe()` async iterator, handle events
  - Support custom `EventSource` (same as TUI's `props.events`)
  - 16ms event batching (port from `sdk.tsx` lines 32-61)
  - Internal `TypedEmitter` for raw events
  - File: `src/client.ts`

- [ ] T009 [US5] Add lifecycle management to `HeadlessClient`
  - `disconnect()`: abort controller, cleanup SSE, clear timers
  - `isConnected` getter
  - `on("connected" | "disconnected" | "error" | "reconnecting" | "reconnected")` lifecycle events
  - Auto-reconnect: when SSE stream ends (not aborted), re-enter connection loop
  - File: `src/client.ts`

- [ ] T010 [US1] Write unit tests for HeadlessClient
  - Mock fetch + SSE stream
  - Test: connect, receive events, disconnect, reconnect, custom event source, batching
  - File: `tests/client.test.ts`

---

## Phase 4: Sync State Store [US2]

- [ ] T011 [US2] Implement `SyncStore` class — state shape and initialization
  - Define full `StoreState` type (from data-model.md)
  - Constructor initializes empty state with `status: "loading"`
  - `snapshot()` method returns current state (read-only)
  - Typed getters: `sessions`, `messages(id)`, `parts(id)`, `permissions(id)`, `questions(id)`, `todos(id)`, `providers`, `agents`, `config`
  - Extends `TypedEmitter<StoreEventMap>` for change events
  - File: `src/store.ts`

- [ ] T012 [US2] Implement `SyncStore.bootstrap()` — initial data fetch
  - Port from `sync.tsx` lines 349-428
  - Blocking: providers, providerList, agents, config, sessionList
  - Non-blocking: commands, LSP, MCP, resources, formatters, session statuses, provider auth, VCS, paths
  - Update `status`: loading → partial → complete
  - Emit `"status"` change events
  - On failure: do NOT throw/exit. Emit `"error"` event via HeadlessClient. Client stays alive. Expose `bootstrap()` as public method for manual retry by adapter.
  - Log bootstrap progress and failures via pluggable logger
  - File: `src/store.ts`

- [ ] T013 [US2] Implement `SyncStore` event handlers — session events
  - `session.updated` → binary search upsert in `session[]`
  - `session.deleted` → binary search remove from `session[]`
  - `session.status` → update `session_status[id]`
  - `session.diff` → update `session_diff[id]`
  - Emit store change events for each
  - File: `src/store.ts`

- [ ] T014 [US2] Implement `SyncStore` event handlers — message events
  - `message.updated` → binary search upsert in `message[sessionID][]`, cap at 100 messages (remove oldest + its parts)
  - `message.removed` → binary search remove
  - `message.part.updated` → binary search upsert in `part[messageID][]`
  - `message.part.delta` → find part, append delta to field
  - `message.part.removed` → binary search remove
  - Emit store change events
  - File: `src/store.ts`

- [ ] T015 [US2] Implement `SyncStore` event handlers — permission, question, todo, misc
  - `permission.asked` → binary search insert
  - `permission.replied` → binary search remove
  - `question.asked` → binary search insert
  - `question.replied` / `question.rejected` → binary search remove
  - `todo.updated` → replace array
  - `lsp.updated` → re-fetch
  - `vcs.branch.updated` → update branch
  - `server.instance.disposed` → re-bootstrap
  - File: `src/store.ts`

- [ ] T016 [US2] Implement `session.status()` derivation
  - Port from `sync.tsx` lines 450-458
  - Check `session.time.compacting`, last message role, `message.time.completed`
  - File: `src/store.ts`

- [ ] T017 [US2] Implement `session.sync()` — full session data fetch
  - Port from `sync.tsx` lines 460-482
  - Fetch session, messages (limit 100), todos, diffs
  - Update store in batch
  - Track synced sessions to avoid re-fetching
  - File: `src/store.ts`

- [ ] T018 [US2] Write unit tests for SyncStore
  - Test each event handler with mock events
  - Test bootstrap sequence with mock SDK client
  - Test session status derivation
  - Test binary search invariants maintained after operations
  - File: `tests/store.test.ts`

---

## Phase 5: Session Operations [US3]

- [ ] T019 [US3] Implement session operation methods on `HeadlessClient`
  - `createSession(options?)` → wraps `sdk.client.session.create()`
  - `prompt(sessionID, text, options?)` → wraps `sdk.client.session.prompt()`
  - `abort(sessionID)` → wraps `sdk.client.session.abort()`
  - `fork(sessionID)` → wraps `sdk.client.session.fork()`
  - `summarize(sessionID, model)` → wraps `sdk.client.session.summarize()`
  - `revert(sessionID, messageID)` → wraps `sdk.client.session.revert()`
  - `unrevert(sessionID)` → wraps `sdk.client.session.unrevert()`
  - `share(sessionID)` / `unshare(sessionID)` → wraps SDK
  - `deleteSession(sessionID)` → wraps `sdk.client.session.delete()`
  - `executeCommand(sessionID, command)` → wraps SDK
  - File: `src/client.ts`

- [ ] T020 [US3] Implement permission and question reply methods
  - `replyPermission(requestID, reply: PermissionReply)` → wraps `sdk.client.permission.reply()`
  - `replyQuestion(requestID, answers: string[][])` → wraps `sdk.client.question.reply()`
  - `rejectQuestion(requestID)` → wraps `sdk.client.question.reject()`
  - File: `src/client.ts`

---

## Phase 6: Adapter Interface & Schemas [US4]

- [ ] T021 [P] [US4] Define `ChannelAdapter` interface and `AdapterCapabilities`
  - Full TypeScript interface per data-model.md
  - All methods typed with proper input/output
  - Optional lifecycle methods: `initialize()`, `shutdown()`
  - File: `src/adapter.ts`

- [ ] T022 [P] [US4] Create Zod schemas for adapter input/output types
  - `PermissionReplySchema`, `QuestionReplySchema`, `ToastNotificationSchema`
  - `AdapterCapabilitiesSchema`
  - `HeadlessClientConfigSchema`
  - Re-export relevant schemas from SDK where available
  - File: `src/schemas.ts`

- [ ] T023 [P] [US4] Create type re-exports module
  - Re-export from `@opencode-ai/sdk/v2`: Session, Message, Part, PermissionRequest, QuestionRequest, Todo, Provider, Agent, Config, Command, LspStatus, McpStatus, SessionStatus, VcsInfo, etc.
  - File: `src/types.ts`

---

## Phase 7: HeadlessRouter [US4]

- [ ] T024 [US4] Implement `HeadlessRouter` class
  - Constructor accepts `HeadlessRouterConfig` (client, store, defaultAdapter?)
  - `registerAdapter(id, adapter)` / `unregisterAdapter(id)`
  - `claimSession(sessionID, adapterID)` / `releaseSession(sessionID)`
  - Subscribe to store change events on construction
  - File: `src/router.ts`

- [ ] T025 [US4] Implement router event dispatch
  - On `message` store event → if assistant message → find adapter for session → call `onAssistantMessage()`
  - On session status transition to `idle` → detect completion → call `onAssistantMessageComplete()` with final message/parts
  - On `permission` store event → find adapter → call `onPermissionRequest()` → await → call `client.replyPermission()`
  - On `question` store event → find adapter → call `onQuestionRequest()` → await → call `client.replyQuestion()` or `client.rejectQuestion()`
  - On `session.status` → call `onSessionStatus()`
  - On `todo` → call `onTodoUpdate()`
  - Timeout handling for permission/question (default 5 min, configurable)
  - Error handling: if adapter throws during onPermissionRequest/onQuestionRequest, auto-reject and log error via logger. Do not propagate — prevent blocking OpenCode session.
  - File: `src/router.ts`

- [ ] T026 [US4] Write unit tests for HeadlessRouter
  - Mock adapter, verify dispatch correctness
  - Test: permission flow (adapter approves, adapter rejects, timeout)
  - Test: question flow (adapter answers, adapter rejects)
  - Test: message streaming → completion detection
  - Test: multi-adapter with different session claims
  - File: `tests/router.test.ts`

---

## Phase 8: Main Entry Point & Packaging [US1-US5]

- [ ] T027 [US1] Wire up `index.ts` — main entry point
  - Export `HeadlessClient`, `SyncStore`, `HeadlessRouter`
  - Export `ChannelAdapter`, `AdapterCapabilities`
  - Export all types, schemas
  - Convenience factory: `createHeadless(config)` → `{ client, store, router }`
  - File: `src/index.ts`

- [ ] T028 [Setup] Configure build: `bun build` for ESM output + declarations
  - Build script in package.json
  - Verify `dist/` output contains `.js` + `.d.ts` files
  - Verify all exports resolve correctly
  - File: `package.json`, `tsconfig.json`

- [ ] T029 [Setup] Write README.md
  - Quick start: connect to server, subscribe to events
  - Adapter interface documentation
  - Architecture diagram (text)
  - API reference for HeadlessClient, SyncStore, HeadlessRouter
  - File: `README.md`

---

## Phase 9: Integration Test

- [ ] T030 [US1-US4] Integration test: end-to-end event flow
  - Create mock adapter implementing `ChannelAdapter`
  - Start HeadlessClient against mock HTTP server
  - Push SSE events through mock
  - Verify: store updates, adapter callbacks fire in order, permission/question flow completes
  - File: `tests/integration.test.ts`

---

## Task Summary

| Phase | Tasks | Parallel? | Depends On |
|-------|-------|-----------|------------|
| 1. Setup | T001-T003 | Sequential | — |
| 2. Utilities | T004-T007 | All parallel | Phase 1 |
| 3. Client | T008-T010 | Sequential | T006 |
| 4. Store | T011-T018 | T011 first, rest sequential | T004, T006 |
| 5. Operations | T019-T020 | Parallel | T008 |
| 6. Adapter/Schemas | T021-T023 | All parallel | Phase 1 |
| 7. Router | T024-T026 | Sequential | T011, T021, T008 |
| 8. Entry + Build | T027-T029 | Sequential | All above |
| 9. Integration | T030 | — | All above |

**Total: 30 tasks**
