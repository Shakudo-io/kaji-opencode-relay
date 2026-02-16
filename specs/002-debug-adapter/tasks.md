# Tasks: Debug/Template Adapter

**Feature ID**: kaji-opencode-relay-002-debug-adapter  
**Created**: 2026-02-16  
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)  
**Depends On**: kaji-opencode-relay-001-headless-core (must be implemented first)

---

## Phase 1: Debug Adapter Core

- [ ] T001 [US2] Implement `DebugAdapter` class — full `ChannelAdapter` implementation
  - Every method from the interface with:
    - Logging to the configured renderer
    - Comments explaining what a real adapter would do
    - Auto-response policies for permissions and questions
  - Constructor accepts `DebugAdapterOptions` (permissionPolicy, questionPolicy, timeouts)
  - Self-contained, < 300 lines
  - File: `src/debug/adapter.ts`

- [ ] T002 [US1] Implement `ConsoleRenderer` — event formatting for terminal
  - `renderEvent(type: string, message: string, details?: object)` — formatted line output
  - Timestamp prefix, event type tag, color support (detect TTY)
  - NDJSON mode: output one JSON object per line
  - Verbose mode: also output raw SSE event
  - Methods for: connected, bootstrap, session, message, text delta, tool status, permission, question, todo, error, complete
  - File: `src/debug/renderer.ts`

---

## Phase 2: CLI Entry Point

- [ ] T003 [US1] Implement CLI — flag parsing and wiring
  - Parse: `--url` (required), `--directory`, `--session <id>`, `--interactive`, `--json`, `--verbose`
  - If `--session` provided, claim only that session. Otherwise, claim all sessions (register as default adapter).
  - Create HeadlessClient → SyncStore → DebugAdapter → HeadlessRouter
  - Register adapter, connect, print status
  - Subscribe to HeadlessClient lifecycle events (`connected`, `disconnected`, `reconnecting`, `reconnected`) → render via ConsoleRenderer
  - Handle SIGINT for clean shutdown
  - File: `src/debug/cli.ts`

- [ ] T004 [US1] Create bin entry point
  - Shebang `#!/usr/bin/env bun`
  - Import and run CLI
  - Add to `package.json` "bin" field
  - File: `bin/debug.ts`, `package.json`

- [ ] T010 [US4] Implement stdin prompt input and session creation
  - Start readline interface on stdin after bootstrap
  - On line input: send as prompt to current session via `client.prompt(sessionID, text)`
  - If no session exists: auto-create via `client.createSession()`, then prompt
  - If `--session <id>` specified: always target that session
  - If multiple sessions and none specified: target most recently active (last in store.state.session)
  - Coexist with event output (render events above, prompt input at bottom)
  - In `--json` mode: emit `{"type":"prompt","sessionID":"...","text":"..."}` for each prompt sent
  - File: `src/debug/cli.ts` (update)

---

## Phase 3: Interactive Mode

- [ ] T005 [US3] Add stdin interactive mode for permissions
  - When `--interactive` and permission arrives: print request, read line from stdin
  - Parse: `1` = allow once, `2` = allow always, `3` = reject
  - Timeout after configurable period → fall back to default policy
  - File: `src/debug/adapter.ts` (update)

- [ ] T006 [US3] Add stdin interactive mode for questions
  - When `--interactive` and question arrives: print options, read line from stdin
  - Parse numeric input for option selection
  - Support multi-select (comma-separated numbers)
  - Support custom text input
  - File: `src/debug/adapter.ts` (update)

---

## Phase 4: Testing & Polish

- [ ] T007 [US1] Write tests for DebugAdapter
  - Mock renderer, verify all adapter methods call renderer correctly
  - Test auto-response policies
  - Test: permission auto-approve, auto-reject, question auto-first-option
  - File: `tests/debug-adapter.test.ts`

- [ ] T008 [US1] Integration test: run debug adapter against mock server
  - Create mock SSE server pushing sample events
  - Run full pipeline: client → store → router → debug adapter
  - Capture console output, verify expected lines
  - File: `tests/debug-integration.test.ts`

- [ ] T009 [Setup] Update package.json exports and README
  - Add `"./debug"` export
  - Add `"bin"` entry for `kaji-opencode-relay-debug`
  - Update README with debug adapter usage section
  - File: `package.json`, `README.md`

---

## Phase 5: Reasoning, File, and Model Rendering

- [ ] T011 [US1] Add reasoning/thinking part rendering to DebugAdapter
  - In `onAssistantMessage`: detect `part.type === "reasoning"`, render with `[THINKING]` tag
  - Show thinking text content (may be long — truncate in text mode, full in JSON mode)
  - File: `src/debug/adapter.ts`, `src/debug/renderer.ts`

- [ ] T012 [US5] Add file part rendering to DebugAdapter
  - In `onAssistantMessage`: detect `part.type === "file"`, render with `[FILE]` tag
  - Show filename, mime type, data size (not full base64)
  - File: `src/debug/adapter.ts`, `src/debug/renderer.ts`

- [ ] T013 [US5] Implement `/attach <filepath>` CLI command
  - Parse `/attach` prefix in stdin input loop
  - Use `createFilePartInput()` to read file and create FilePartInput
  - Queue file for next prompt — send with `client.promptWithFiles()`
  - Support multiple `/attach` commands before sending prompt
  - File: `src/debug/cli.ts`

- [ ] T014 [US1] Add model info display
  - Show model/provider info when available in response metadata
  - File: `src/debug/renderer.ts`

- [ ] T015 [US5, US7] Write live tests for reasoning, files, and model override
  - Test: send image file via `/attach`, verify LLM acknowledges image
  - Test: verify reasoning parts render with `[THINKING]` tag
  - Test: verify file parts render with `[FILE]` tag
  - Test: model override display
  - File: `tests/debug-live-features.test.ts`

---

## Phase 6: Cost/Token Tracking [US6]

- [ ] T016 [US6] Add `sessionCost` and `sessionTokens` running accumulators to SyncStore (001 change)
  - In `message.updated` handler: when assistant message arrives, accumulate `message.cost` into `state.session_cost[sessionID]`
  - Accumulate tokens: `state.session_tokens[sessionID]` with `{ input, output, reasoning, cacheRead, cacheWrite }`
  - Never reset on message eviction — running total survives the 100-message cap
  - Add store accessors: `store.sessionCost(sessionID)`, `store.sessionTokens(sessionID)`
  - Emit `"sessionCost"` change event when cost updates
  - File: `src/store.ts`

- [ ] T017 [US6] Add cost/token rendering to DebugAdapter
  - In `onAssistantMessage`: when StepFinishPart detected, render `[STEP]` with cost/tokens
  - In `onAssistantMessageComplete`: render `[COST]` with message cost and token breakdown
  - Render token breakdown: `{input} in / {output} out / {reasoning} reasoning / {cacheRead} cache`
  - Format cost as USD: `$0.03`, `$0.003`, etc.
  - File: `src/debug/adapter.ts`, `src/debug/renderer.ts`

- [ ] T018 [US6] Show session aggregate cost on idle
  - When session status transitions to idle: render `[SESSION] Total: ${cost} | {tokens} tokens`
  - Read from `store.sessionCost(sessionID)` and `store.sessionTokens(sessionID)`
  - File: `src/debug/adapter.ts`

---

## Phase 7: Model Display [US7]

- [ ] T019 [US7] Add model identification rendering to DebugAdapter
  - In `onAssistantMessage`: extract `message.providerID` and `message.modelID`
  - Render `[MODEL] {providerID}/{modelID}` on first part of each new assistant message
  - Track last seen model — if it changes between messages, highlight with `[MODEL CHANGED]`
  - File: `src/debug/adapter.ts`, `src/debug/renderer.ts`

---

## Phase 8: Subtask/Subagent Display [US8]

- [ ] T020 [US8] Add subtask part rendering to DebugAdapter
  - In `onAssistantMessage`: detect `part.type === "subtask"`, render with `[SUBTASK]`
  - Show: agent name, description (truncated), model if present
  - File: `src/debug/adapter.ts`, `src/debug/renderer.ts`

- [ ] T021 [US8] Add task tool delegation rendering to DebugAdapter
  - In `onAssistantMessage`: detect `part.type === "tool"` where `part.tool === "task"`
  - When running: render `[SUBTASK] 🕵️ {agentType} — "{description}" (running)`
  - When completed: render `[SUBTASK] ✅ {agentType} — completed ({elapsed}, {toolCount} tools) | ${cost}`
  - Extract agent type from `state.input.subagent_type` or `state.input.category`
  - Extract timing from `state.time.start` / `state.time.end`
  - File: `src/debug/adapter.ts`, `src/debug/renderer.ts`

---

## Phase 9: Live Tests for New Features [US6, US7, US8]

- [ ] T022 [US6] Live test: cost and token tracking
  - Send a simple prompt, wait for completion
  - Verify `AssistantMessage.cost > 0` and `AssistantMessage.tokens` has non-zero values
  - Verify `store.sessionCost(sessionID) > 0`
  - Verify `store.sessionTokens(sessionID)` has non-zero input/output
  - Log full cost/token breakdown in [RESULT] NDJSON for manual review
  - File: `tests/live-cost-model-subtask.test.ts`

- [ ] T023 [US7] Live test: model identification
  - Send a prompt with default model, verify `message.modelID` and `message.providerID` are present
  - Send a prompt with model override (`z-ai/glm-5`), verify different modelID on response
  - Log both model IDs in [RESULT] NDJSON for manual review
  - File: `tests/live-cost-model-subtask.test.ts`

- [ ] T024 [US8] Live test: subtask/subagent delegation
  - Send prompt that triggers task tool: "Use the task tool to delegate a simple research task"
  - Wait for completion
  - Verify `SubtaskPart` or `ToolPart` with `tool === "task"` appears in parts
  - Log subtask details (agent, description, timing, cost) in [RESULT] NDJSON for manual review
  - File: `tests/live-cost-model-subtask.test.ts`

- [ ] T025 [US6, US7, US8] Live test: verify debug adapter renders new features
  - Run DebugAdapter with JSON renderer against the test session
  - Capture adapter output
  - Verify `[COST]`, `[MODEL]`, `[SUBTASK]` events appear in adapter output
  - File: `tests/live-cost-model-subtask.test.ts`

---

## Task Summary

| Phase | Tasks | Depends On |
|-------|-------|------------|
| 1. Core | T001-T002 | 001-headless-core complete |
| 2. CLI | T003-T004, T010 | T001, T002 |
| 3. Interactive | T005-T006 | T003, T010 |
| 4. Testing | T007-T009 | T005, T006 |
| 5. Reasoning/Files/Model | T011-T015 | T001, T003, 001-T031 (file utils) |
| 6. Cost/Token | T016-T018 | T001, store.ts |
| 7. Model Display | T019 | T001, T017 |
| 8. Subtask/Subagent | T020-T021 | T001 |
| 9. Live Tests | T022-T025 | T016-T021 |

**Total: 25 tasks**
**New tasks in this update: T016-T025 (10 tasks)**
**Phases 1-5 already implemented. Phases 6-9 are new.**
