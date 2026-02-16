# Specification: Debug/Template Adapter

**Feature ID**: kaji-opencode-relay-002-debug-adapter  
**Status**: Draft  
**Created**: 2026-02-16  
**Priority**: P1 — Validates headless core, serves as template for real adapters  
**Depends On**: kaji-opencode-relay-001-headless-core  
**Modifies**: Also adds `sessionCost` accumulator and `sessionTokens` to SyncStore (001 change)

---

## Overview

A debug/template adapter that implements the `ChannelAdapter` interface from `kaji-opencode-relay`. It logs all events to the console (or a configurable output), auto-responds to permissions and questions, and serves two purposes:

1. **Debug tool**: Developers building new adapters can run the debug adapter to see exactly what events flow through the system and in what order
2. **Template**: Copy-paste starting point for building real adapters (Mattermost, Slack, Copilot, etc.)

This adapter renders to **stdout** with structured, human-readable output — no TUI, no Ink, just plain formatted text.

---

## Clarifications

### Session 2026-02-16
- Q: How should the debug adapter claim sessions? → A: Auto-claim all sessions by default. Add optional `--session <id>` flag to filter to a specific session.
- Q: Should the debug CLI allow sending prompts? → A: Yes — observer + prompt input + session create. Fully self-contained test harness.
- Q: How should `--verbose` and `--json` interact? → A: Combined. In JSON mode, `--verbose` adds a `rawEvent` field to each JSON line. In text mode, it prints the raw SSE event below the formatted line.
- Q: What happens when the server disconnects? → A: Print `[DISCONNECTED]` / `[RECONNECTING]` / `[RECONNECTED]` status lines. Rely on HeadlessClient's built-in auto-reconnection.
- Q: Show reasoning/thinking parts by default? → A: Yes, always show `[THINKING]` parts. This is a debug tool.
- Q: How to compute session aggregate cost? → A: Running total accumulator in the SyncStore. Increments on every `message.updated` for assistant messages. Never resets when old messages evict from the 100-message cap. This is a store-level change (001), not just a debug adapter change.
- Q: How to trigger subtask delegation in live tests? → A: Direct prompt asking LLM to use the task tool.

---

## User Stories

### US1: Run a headless OpenCode session with console output [P1]
**As a** developer evaluating kaji-opencode-relay  
**I want to** run a debug adapter that shows me everything happening in an OpenCode session  
**So that** I understand the event flow before building a real adapter

**Acceptance Scenarios:**
- Given an OpenCode server URL, I can run `npx kaji-opencode-relay-debug --url http://localhost:4096`
- The debug adapter connects, bootstraps, and prints connection status
- When a session is created, it prints session info (ID, project, directory)
- When an assistant message streams, it prints text deltas in real-time
- When reasoning/thinking parts arrive, it prints them with a `[THINKING]` tag
- When file parts arrive (images, documents), it prints filename, mime type, and size
- When model override is used, it shows which model is responding
- When a permission request arrives, it auto-approves (configurable: auto-approve, auto-reject, prompt stdin)
- When a question arrives, it auto-selects the first option (configurable)
- When todos update, it prints the todo list
- When the session goes idle, it prints "Session idle — waiting for input"
- All output is prefixed with timestamps and event type tags
- When the server disconnects, it prints `[DISCONNECTED]` / `[RECONNECTING]` / `[RECONNECTED]` status lines

### US4: Send prompts and create sessions from the CLI [P1]
**As a** developer testing the relay end-to-end  
**I want to** type prompts directly into the debug CLI  
**So that** I can drive a full OpenCode session without needing a separate TUI

**Acceptance Scenarios:**
- When I type text and press Enter, it sends the text as a prompt to the current session
- If no session exists, typing input creates a new session automatically, then sends the prompt
- If `--session <id>` is specified, prompts go to that session
- If multiple sessions exist and none is specified, prompts go to the most recently active session
- Stdin prompt input coexists with event output (input prompt line, output events above)

### US5: Attach files from the CLI [P1]
**As a** developer testing file attachment flows  
**I want to** attach files to prompts from the debug CLI  
**So that** I can test the full bidirectional file flow

**Acceptance Scenarios:**
- Typing `/attach <filepath>` adds a file to the next prompt
- Image files (png, jpg, gif, webp) are sent as `FilePartInput` with base64 data URI
- Non-image files (txt, md, json, etc.) are sent as `FilePartInput` with base64 data URI
- When the LLM responds with `FilePart` attachments, they are rendered with `[FILE]` tag showing filename, mime, and size
- The `--json` mode includes the full file data URI in the JSON output

### US6: See cost and token usage per message and session [P1]
**As a** developer monitoring LLM spending  
**I want to** see cost and token counts for each assistant response and session totals  
**So that** I can track spending and optimize prompts

**Acceptance Scenarios:**
- When an assistant message completes, the debug adapter shows: `[COST] $0.03 | 1,234 in / 567 out / 89 reasoning / 45 cache-read`
- Session aggregate cost is shown on demand or when session goes idle: `[SESSION] Total: $0.45 | 12,345 tokens`
- `StepFinishPart` cost/token data is rendered with `[STEP]` tag
- In `--json` mode, cost and token fields are included on every message/step event
- Token counts are broken down: input, output, reasoning, cache read, cache write

### US7: See which model is used for each response [P1]
**As a** developer debugging model routing  
**I want to** see which LLM model and provider handled each assistant response  
**So that** I can verify model selection and override behavior

**Acceptance Scenarios:**
- When an assistant message arrives, the header shows: `[MODEL] anthropic/claude-sonnet-4-20250514`
- Model info comes from `AssistantMessage.providerID` and `.modelID`
- If the model changes between messages (e.g., model override), the change is highlighted
- In `--json` mode, `providerID` and `modelID` are included on every assistant message event

### US8: See subagent/task delegation progress [P1]
**As a** developer monitoring multi-agent workflows  
**I want to** see when tasks are delegated to sub-agents and track their progress  
**So that** I can understand the delegation tree and timing

**Acceptance Scenarios:**
- When a `task` tool starts running, render: `[SUBTASK] 🕵️ Build — "implement auth module" (running)`
- When a `SubtaskPart` arrives, render: `[SUBTASK] agent=Build, model=anthropic/claude-sonnet-4, prompt="implement auth..."`
- When a `task` tool completes, render: `[SUBTASK] ✅ Build — completed (2m 34s, 12 tools) | $0.45`
- Track child session IDs via `ToolStateRunning.input` and `Session.parentID`
- In `--json` mode, subtask events include childSessionId, agentType, timing, cost

### US2: Use as a template for new adapters [P1]
**As a** developer building a new channel adapter  
**I want to** copy the debug adapter as a starting point  
**So that** I have a working example of every adapter method

**Acceptance Scenarios:**
- The adapter implements every method in the `ChannelAdapter` interface
- Each method has clear comments explaining what a real adapter should do
- The adapter code is self-contained (adapter.ts + renderer.ts)
- The adapter can be registered with `HeadlessRouter` using the standard API

### US3: Interactive mode for testing permissions and questions [P2]
**As a** developer testing permission/question flows  
**I want to** manually respond to permissions and questions from stdin  
**So that** I can test the full interactive flow without a real channel

**Acceptance Scenarios:**
- With `--interactive` flag, permission requests prompt on stdin: "Allow once / Allow always / Reject? [1/2/3]"
- With `--interactive` flag, questions display options and wait for numeric input
- Without the flag, defaults apply (auto-approve permissions, auto-select first option for questions)
- Timeout handling works: if no stdin response within 60s, falls back to default

---

## Functional Requirements

### FR1: CLI Entry Point
- Runnable as `npx kaji-opencode-relay-debug` or `bun run src/cli.ts`
- Accept flags: `--url <server-url>`, `--directory <path>`, `--session <id>`, `--interactive`, `--verbose`, `--json`
- `--session <id>` filters to a specific session (default: claim all sessions, show all events)
- `--json` mode outputs NDJSON (newline-delimited JSON) — one event per line — for pipe-ability
- `--verbose` in text mode: prints the raw SSE event below each formatted line. In JSON mode: adds a `rawEvent` field to each JSON line. Both flags can be combined.
- Accepts typed input from stdin as prompts (send to the current/only session)
- Can create new sessions: typing input when no session exists creates one automatically
- On server disconnect: prints `[DISCONNECTED]` / `[RECONNECTING]` / `[RECONNECTED]` status. Relies on HeadlessClient auto-reconnection — does not exit.

### FR2: Console Renderer
- All output to stdout with structured format:
  ```
  [HH:MM:SS] [EVENT_TYPE] message
  ```
- Color output (ANSI) when stdout is a TTY, plain when piped
- Message streaming shows text accumulating (overwrite current line, or append)
- Tool execution shows tool name, status, and timing
- Diff display shows unified diff format for edit permissions
- Reasoning/thinking parts rendered with `[THINKING]` tag — shows thinking text content
- File parts rendered with `[FILE]` tag — shows filename, mime type, and data size (not the full base64)
- Model info shown on each assistant message: `[MODEL] {providerID}/{modelID}`
- Cost shown on message completion: `[COST] ${cost} | {input} in / {output} out / {reasoning} reasoning / {cache_read} cache`
- Session aggregate cost shown when session goes idle: `[SESSION] Total: ${total} | {total_tokens} tokens`
- StepFinishPart rendered with `[STEP]` tag showing per-step cost/tokens
- SubtaskPart rendered with `[SUBTASK]` tag showing agent, description, model
- Task tool (tool name `task`) rendered with `[SUBTASK]` tag showing delegation lifecycle: running → completed with timing and tool count

### FR3: Auto-Response Policies
- Configurable via constructor options:
  ```typescript
  {
    permissionPolicy: "approve-all" | "reject-all" | "interactive"
    questionPolicy: "first-option" | "interactive"
    permissionTimeout: number  // ms, default 60000
    questionTimeout: number    // ms, default 60000
  }
  ```

### FR4: Complete ChannelAdapter Implementation
- Every method implemented with logging + configurable behavior
- Serves as reference implementation for adapter authors
- AdapterCapabilities: `{ streaming: false, richFormatting: false, interactiveButtons: false, fileUpload: false, diffViewer: false, codeBlocks: true }`

---

## Scope Boundaries

### In Scope
- Debug adapter implementing full `ChannelAdapter` interface
- CLI entry point with flag parsing
- Console output formatting
- Rendering all part types: text, tool, reasoning/thinking, file, subtask
- Cost and token display per message and session aggregate
- Model/provider identification per assistant response
- Subagent/task delegation tracking and progress display
- File attachment from CLI via `/attach <filepath>` command
- Auto-response policies for permissions/questions
- Interactive stdin mode
- NDJSON output mode
- Stdin prompt input (send user messages to OpenCode)
- Auto-create session when none exists
- Connection lifecycle display (disconnect/reconnect status)
- Model override display

### Out of Scope
- Persistence of any kind
- Real channel integration
- User authentication
- Web UI
- File handling (just logs file references)

---

## Key Entities

| Entity | Description |
|--------|-------------|
| `DebugAdapter` | Implements `ChannelAdapter`, logs to console |
| `ConsoleRenderer` | Formats events for terminal display |
| `CLI` | Parses args, creates client + store + router + adapter, runs main loop |

---

## Success Criteria

- A developer can run the debug adapter against a live OpenCode server and see the full event flow
- The adapter correctly handles all event types from the headless core
- Cost/token data is visible for every assistant response
- Model ID is visible for every assistant response
- Subtask/delegation events are visible with timing and cost
- The NDJSON output mode can be piped to `jq` for analysis
- The interactive mode successfully completes a permission and question flow via stdin
- Live tests produce NDJSON output with natural language content that an AI agent can review to verify correctness
- The adapter code is clean enough to serve as a copy-paste template (adapter.ts + renderer.ts)
