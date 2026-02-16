# Tasks: Debug/Template Adapter

**Feature ID**: opencode-headless-002-debug-adapter  
**Created**: 2026-02-16  
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)  
**Depends On**: opencode-headless-001-headless-core (must be implemented first)

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
  - Handle SIGINT for clean shutdown
  - File: `src/debug/cli.ts`

- [ ] T004 [US1] Create bin entry point
  - Shebang `#!/usr/bin/env bun`
  - Import and run CLI
  - Add to `package.json` "bin" field
  - File: `bin/debug.ts`, `package.json`

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
  - Add `"bin"` entry for `opencode-headless-debug`
  - Update README with debug adapter usage section
  - File: `package.json`, `README.md`

---

## Task Summary

| Phase | Tasks | Depends On |
|-------|-------|------------|
| 1. Core | T001-T002 | 001-headless-core complete |
| 2. CLI | T003-T004 | T001, T002 |
| 3. Interactive | T005-T006 | T003 |
| 4. Testing | T007-T009 | T005, T006 |

**Total: 9 tasks**
