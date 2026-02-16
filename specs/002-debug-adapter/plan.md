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
  ├── Parse flags (--url, --interactive, --json, --verbose)
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
  └── Wait for events (runs until Ctrl+C)
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

**NDJSON mode** (`--json`):
```json
{"ts":"2026-02-16T10:30:15Z","type":"connected","url":"http://localhost:4096"}
{"ts":"2026-02-16T10:30:17Z","type":"message","sessionID":"ses_abc1","role":"user","text":"List all TypeScript files"}
{"ts":"2026-02-16T10:30:18Z","type":"permission","sessionID":"ses_abc1","permission":"bash","reply":"once"}
```
