# Specification: Debug/Template Adapter

**Feature ID**: opencode-headless-002-debug-adapter  
**Status**: Draft  
**Created**: 2026-02-16  
**Priority**: P1 — Validates headless core, serves as template for real adapters  
**Depends On**: opencode-headless-001-headless-core

---

## Overview

A debug/template adapter that implements the `ChannelAdapter` interface from `opencode-headless`. It logs all events to the console (or a configurable output), auto-responds to permissions and questions, and serves two purposes:

1. **Debug tool**: Developers building new adapters can run the debug adapter to see exactly what events flow through the system and in what order
2. **Template**: Copy-paste starting point for building real adapters (Mattermost, Slack, Copilot, etc.)

This adapter renders to **stdout** with structured, human-readable output — no TUI, no Ink, just plain formatted text.

---

## Clarifications

### Session 2026-02-16
- Q: How should the debug adapter claim sessions? → A: Auto-claim all sessions by default. Add optional `--session <id>` flag to filter to a specific session.

---

## User Stories

### US1: Run a headless OpenCode session with console output [P1]
**As a** developer evaluating opencode-headless  
**I want to** run a debug adapter that shows me everything happening in an OpenCode session  
**So that** I understand the event flow before building a real adapter

**Acceptance Scenarios:**
- Given an OpenCode server URL, I can run `npx opencode-headless-debug --url http://localhost:4096`
- The debug adapter connects, bootstraps, and prints connection status
- When a session is created, it prints session info (ID, project, directory)
- When an assistant message streams, it prints text deltas in real-time
- When a permission request arrives, it auto-approves (configurable: auto-approve, auto-reject, prompt stdin)
- When a question arrives, it auto-selects the first option (configurable)
- When todos update, it prints the todo list
- When the session goes idle, it prints "Session idle — waiting for input"
- All output is prefixed with timestamps and event type tags

### US2: Use as a template for new adapters [P1]
**As a** developer building a new channel adapter  
**I want to** copy the debug adapter as a starting point  
**So that** I have a working example of every adapter method

**Acceptance Scenarios:**
- The adapter implements every method in the `ChannelAdapter` interface
- Each method has clear comments explaining what a real adapter should do
- The code is self-contained in a single file (< 300 lines)
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
- Runnable as `npx opencode-headless-debug` or `bun run src/cli.ts`
- Accept flags: `--url <server-url>`, `--directory <path>`, `--session <id>`, `--interactive`, `--verbose`, `--json`
- `--session <id>` filters to a specific session (default: claim all sessions, show all events)
- `--json` mode outputs NDJSON (newline-delimited JSON) — one event per line — for pipe-ability
- `--verbose` shows raw SSE events in addition to formatted output

### FR2: Console Renderer
- All output to stdout with structured format:
  ```
  [HH:MM:SS] [EVENT_TYPE] message
  ```
- Color output (ANSI) when stdout is a TTY, plain when piped
- Message streaming shows text accumulating (overwrite current line, or append)
- Tool execution shows tool name, status, and timing
- Diff display shows unified diff format for edit permissions

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
- Auto-response policies for permissions/questions
- Interactive stdin mode
- NDJSON output mode

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
- The NDJSON output mode can be piped to `jq` for analysis
- The interactive mode successfully completes a permission and question flow via stdin
- The source code is clean enough to serve as a copy-paste template (< 300 lines for the adapter itself)
