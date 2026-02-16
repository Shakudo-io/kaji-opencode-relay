# Implementation Plan: OpenCode Headless Core

**Feature ID**: kaji-opencode-relay-001-headless-core  
**Created**: 2026-02-16  
**Spec**: [spec.md](./spec.md)

---

## Technical Context

### Language & Runtime
- **TypeScript** with strict mode
- **Bun** for development, build, and test
- Compiled to ESM for distribution (compatible with Node.js 18+, Bun, Deno)
- Published as `kaji-opencode-relay` on npm

### Key Dependencies
| Package | Purpose | Version |
|---------|---------|---------|
| `@opencode-ai/sdk` | SDK client, types, SSE subscription | ^1.2.5 |
| `zod` | Schema validation for adapter interfaces | ^3.23 (or ^4.x if SDK uses v4) |

### Zero Dependencies (NOT included)
- No SolidJS (`solid-js`, `solid-js/store`)
- No @opentui/* (rendering)
- No Ink, React, or any UI framework

### Build & Packaging
- `bun build` for compilation
- Output: ESM (`dist/index.js`) + TypeScript declarations (`dist/index.d.ts`)
- Package exports: `"."`, `"./types"`, `"./adapter"`, `"./store"`
- tsconfig: strict, ESM target, declaration emit

---

## Architecture

### Module Structure

```
kaji-opencode-relay/
├── src/
│   ├── index.ts              # Main entry: HeadlessClient + re-exports
│   ├── client.ts             # HeadlessClient - wraps SDK, manages SSE lifecycle
│   ├── files.ts              # File attachment utilities: createFilePartInput, createFilePartInputFromBuffer
│   ├── store.ts              # SyncStore - event→state mapping (ported from sync.tsx)
│   ├── router.ts             # HeadlessRouter - dispatches events to adapters
│   ├── adapter.ts            # ChannelAdapter interface + AdapterCapabilities
│   ├── schemas.ts            # Zod schemas for adapter input/output
│   ├── binary.ts             # Binary search utility (ported from @opencode-ai/util)
│   ├── events.ts             # Event types and EventEmitter wrapper
│   └── types.ts              # Re-exported types from @opencode-ai/sdk/v2
├── tests/
│   ├── client.test.ts
│   ├── store.test.ts
│   ├── router.test.ts
│   └── binary.test.ts
├── package.json
├── tsconfig.json
├── README.md
└── LICENSE
```

### Data Flow

```
OpenCode Server
     │
     │ SSE events (or custom EventSource)
     ▼
HeadlessClient
     │
     │ raw events (batched at 16ms)
     ▼
SyncStore ──────────── change events ────────► subscribers
     │
     │ structured state + events
     ▼
HeadlessRouter
     │
     │ dispatches to adapter by session mapping
     ▼
ChannelAdapter(s)
     │
     │ renders to channel (Mattermost, Slack, etc.)
     ▼
End User
```

### Porting Strategy from TUI

The core logic to port comes from three TUI files. Here's how each maps:

| TUI Source | Headless Target | Changes Required |
|------------|----------------|-----------------|
| `context/sdk.tsx` (~100 lines) | `client.ts` | Replace SolidJS lifecycle (`onMount`/`onCleanup`) with class methods. Replace `createGlobalEmitter` with native `EventEmitter`. Keep 16ms batching logic intact. |
| `context/sync.tsx` (~490 lines) | `store.ts` | Replace `createStore`/`produce`/`reconcile` with plain object mutation + change events. Port all 18+ event handlers. Port bootstrap sequence. Port `session.status()` derivation. Binary search stays identical. |
| `util/binary.ts` (~42 lines) | `binary.ts` | Copy as-is — zero dependencies. |

### SyncStore Design (replacing SolidJS reactivity)

The TUI uses SolidJS `createStore` with `produce` (Immer-like) and `reconcile` (deep diff merge). We replace this with:

1. **Plain mutable state object** — same shape as the SolidJS store
2. **Immutable snapshots** — `store.snapshot()` returns a deep-frozen copy
3. **Change events** — `store.on("sessions", callback)` for granular subscriptions
4. **Batch** — same 16ms batching from the SDK event queue means store updates are already batched

Operations that used `produce`:
- Array splice (insert/remove at binary search index) → direct `Array.splice()`
- Object property set → direct `state.x = y`
- Nested property update → direct assignment

Operations that used `reconcile`:
- Deep-merge server response into store → `Object.assign()` or spread for shallow, manual merge for deep

### HeadlessRouter Design

```typescript
class HeadlessRouter {
  private adapters: Map<string, ChannelAdapter> = new Map()      // adapterID → adapter
  private sessionMap: Map<string, string> = new Map()             // sessionID → adapterID
  private logger: Logger                                          // pluggable logger
  
  registerAdapter(id: string, adapter: ChannelAdapter): void
  unregisterAdapter(id: string): void
  
  // Claim a session for an adapter
  claimSession(sessionID: string, adapterID: string): void
  releaseSession(sessionID: string): void
  
  // Internal: called by store change events
  private dispatch(event: RouterEvent): void
}
```

The router subscribes to the SyncStore's change events. When state changes:
- **Message update** → find adapter for session → call `onAssistantMessage()`
- **Permission asked** → find adapter → call `onPermissionRequest()`, await response, call `client.permission.reply()`
- **Question asked** → find adapter → call `onQuestionRequest()`, await response, call `client.question.reply()`
- **Session status change** → call `onSessionStatus()`
- **Todo update** → call `onTodoUpdate()`

**Error handling for permission/question dispatch:**
- If adapter throws: auto-reject the permission/question, log error via pluggable logger
- If adapter times out (configurable, default 5 min): auto-reject, log warning
- This prevents a broken/hung adapter from blocking the OpenCode session

If no adapter claims a session, events are logged but not lost (the store still has them).

### Pluggable Logger

```typescript
interface Logger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}
```

Default: no-op logger. Consumers pass their own (e.g., `console`, pino, winston adapter).
Used in: HeadlessClient (SSE events, reconnection), SyncStore (bootstrap, event processing), HeadlessRouter (dispatch errors, timeouts).

---

## Constitution Compliance

This is a new package in a new repo, not a TUI. The Mattermost plugin constitution's TUI/Ink requirements don't apply. However, we adopt:

- **Test-first approach**: Unit tests for store, client, router
- **Bun runtime**: As specified in constitution
- **E2E-like tests**: Connect to a mock server, verify full event flow

---

## Project Structure (Package Exports)

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./types": "./dist/types.js",
    "./adapter": "./dist/adapter.js",
    "./store": "./dist/store.js",
    "./schemas": "./dist/schemas.js"
  }
}
```

| Export | Contents |
|--------|----------|
| `kaji-opencode-relay` | `HeadlessClient`, `HeadlessRouter`, `SyncStore` + everything |
| `kaji-opencode-relay/types` | All re-exported types from SDK |
| `kaji-opencode-relay/adapter` | `ChannelAdapter` interface, `AdapterCapabilities` |
| `kaji-opencode-relay/store` | `SyncStore` standalone (for advanced use) |
| `kaji-opencode-relay/schemas` | Zod schemas for adapter I/O validation |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| SDK types change between versions | Pin `@opencode-ai/sdk` to exact version, test on CI |
| SyncStore event handling diverges from TUI | Port tests that replay recorded event sequences |
| Adapter interface too rigid/flexible | Start minimal, extend based on real adapter implementations |
| Binary search assumption (sorted IDs) breaks | Unit tests with real OpenCode session IDs |

---

## Testing Strategy

| Layer | Approach |
|-------|----------|
| **Binary search** | Unit tests with sorted/unsorted arrays |
| **SyncStore** | Replay recorded SSE event sequences, verify store state |
| **HeadlessClient** | Mock HTTP server, verify SSE reconnection behavior |
| **HeadlessRouter** | Mock adapter, verify correct dispatch per session |
| **Integration** | Connect to real OpenCode server, create session, send prompt, verify state |
