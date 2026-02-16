# Implementation Plan: Debug/Template Adapter

**Feature ID**: kaji-opencode-relay-002-debug-adapter  
**Created**: 2026-02-16  
**Spec**: [spec.md](./spec.md)

---

## Technical Context

- Lives in the **same repo** as kaji-opencode-relay (`kaji-opencode-relay/`)
- Located at `src/debug/` — shipped as part of the package
- CLI entry point: `bin/debug.ts` (exported in package.json `"bin"`)
- Depends on the headless core (same package, relative imports)

### Module Structure

```
kaji-opencode-relay/
├── src/
│   ├── ...                    # (Phase 0 headless core)
│   └── debug/
│       ├── adapter.ts         # DebugAdapter implements ChannelAdapter
│       ├── renderer.ts        # ConsoleRenderer — formats output
│       └── cli.ts             # CLI entry point — flag parsing, wiring
├── bin/
│   └── debug.ts               # Bun-compatible shebang entry: `#!/usr/bin/env bun`
```

### Architecture

```
CLI (bin/debug.ts)
  │
  ├── Parse flags (--url, --session, --interactive, --json, --verbose)
  │
  ├── Create HeadlessClient(config)
  ├── Create SyncStore(client)
  ├── Create DebugAdapter(options)
  ├── Create HeadlessRouter(client, store)
  │
  ├── router.registerAdapter("debug", adapter)
  │
  ├── client.connect()
  │   → store.bootstrap()
  │   → print "Connected to OpenCode at <url>"
  │
  ├── Subscribe to client lifecycle events
  │   → "disconnected" / "reconnecting" / "reconnected" → print status
  │
  ├── Start stdin input loop (readline)
  │   → On line: if no session → client.createSession() then client.prompt()
  │   →          if session exists → client.prompt(sessionID, text)
  │
  └── Wait for events + stdin (runs until Ctrl+C)
```

### Output Format

**Standard mode** (TTY):
```
[10:30:15] [CONNECTED]    Connected to OpenCode at http://localhost:4096
[10:30:15] [BOOTSTRAP]    Loaded 3 providers, 5 agents, 12 sessions
[10:30:16] [SESSION]      ses_abc1 — my-project (/home/user/project)
[10:30:17] [MESSAGE]      ▶ User: "List all TypeScript files"
[10:30:18] [STATUS]       ses_abc1 → working
[10:30:18] [TOOL]         bash: ls -la src/**/*.ts (running)
[10:30:19] [TOOL]         bash: completed (1.2s)
[10:30:19] [TEXT]         Here are the TypeScript files in your project:
[10:30:20] [TEXT]         - src/index.ts (continued...)
[10:30:21] [COMPLETE]     ses_abc1 — response complete ($0.03, 1.2K tokens)
[10:30:21] [STATUS]       ses_abc1 → idle
```

**New output types (Phases 6-8):**
```
[10:30:18] [MODEL]        anthropic/claude-sonnet-4-20250514
[10:30:19] [STEP]         $0.01 | 456 in / 123 out / 0 reasoning / 200 cache
[10:30:21] [COST]         $0.03 | 1,234 in / 567 out / 89 reasoning / 45 cache
[10:30:21] [SESSION]      Total: $0.45 | 12,345 tokens
[10:30:22] [SUBTASK]      🕵️ Build — "implement auth module" (running)
[10:30:45] [SUBTASK]      ✅ Build — completed (23s, 4 tools) | $0.12
```

**NDJSON mode** (`--json`):
```json
{"ts":"2026-02-16T10:30:15Z","type":"connected","url":"http://localhost:4096"}
{"ts":"2026-02-16T10:30:17Z","type":"message","sessionID":"ses_abc1","role":"user","text":"List all TypeScript files"}
{"ts":"2026-02-16T10:30:18Z","type":"model","sessionID":"ses_abc1","providerID":"anthropic","modelID":"claude-sonnet-4-20250514"}
{"ts":"2026-02-16T10:30:21Z","type":"cost","sessionID":"ses_abc1","cost":0.03,"tokens":{"input":1234,"output":567,"reasoning":89,"cacheRead":45,"cacheWrite":0}}
{"ts":"2026-02-16T10:30:22Z","type":"subtask","sessionID":"ses_abc1","agentType":"Build","description":"implement auth","status":"running"}
```

### Store Changes (Phase 6)

```typescript
// New fields added to SyncState:
interface SyncState {
  // ... existing fields ...
  session_cost: Record<string, number>           // sessionID → running USD total
  session_tokens: Record<string, TokenSummary>   // sessionID → running token totals
}

interface TokenSummary {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}
```

Updated in the `message.updated` handler: when an assistant message arrives, accumulate cost and tokens. Never resets on message eviction.
