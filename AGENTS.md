# AGENTS.md — kaji-opencode-relay

## Project Overview
Universal relay library for OpenCode. Wraps the OpenCode server's HTTP+SSE protocol into a reusable adapter framework.

- Runtime: Bun (primary), Node.js 18+ (compatible)
- Peer dependency: @opencode-ai/sdk
- Published as: kaji-opencode-relay (npm)

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

Key source files:
- `src/client.ts` — HeadlessClient (connection, SSE, operations)
- `src/store.ts` — SyncStore (event→state, change events)
- `src/router.ts` — HeadlessRouter (adapter dispatch, permission/question round-trips)
- `src/adapter.ts` — ChannelAdapter interface
- `src/types.ts` — All type re-exports from SDK
- `src/schemas.ts` — Zod validation schemas
- `src/files.ts` — File attachment utilities
- `src/debug/` — Debug CLI adapter (reference implementation)

## Commands
```bash
bun install          # Install dependencies
bun test             # Run unit tests
bun run build        # Build to dist/
bun run typecheck    # Type-check without emitting
```

## Code Style
See `.opencode/rules/typescript.md`

## Git Conventions
See `.opencode/rules/git.md`

## Testing
See `.opencode/rules/testing.md`

## Design Specs
- `specs/001-headless-core/` — Core library design (spec, plan, data model)
- `specs/002-debug-adapter/` — Debug CLI adapter design

## Do NOT
- Add rendering/UI dependencies
- Import SDK types directly (use `src/types.ts` re-exports)
- Modify ChannelAdapter without updating Zod schemas
- Suppress TypeScript errors
- Delete or skip failing tests
- Open PRs without an issue reference
