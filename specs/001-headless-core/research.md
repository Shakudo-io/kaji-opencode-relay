# Research: OpenCode Headless Core

**Feature ID**: kaji-opencode-relay-001-headless-core  
**Created**: 2026-02-16

---

## Design Decision 1: State Management (replacing SolidJS)

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **Plain object + EventEmitter** | Zero deps, simplest to understand, works everywhere | No fine-grained reactivity, manual change tracking |
| Zustand | Popular, works without React, middleware support | Unnecessary dependency for library consumers |
| RxJS Observables | Powerful composition, backpressure | Heavy dep, steep learning curve for adapter authors |
| Proxy-based (MobX-style) | Auto-tracking, minimal boilerplate | Complex, debugging harder, bundle size |

### Decision: **Plain object + EventEmitter**

**Rationale**: The store is updated by a known set of SSE event handlers. We don't need auto-tracking — we know exactly when state changes because we're processing events one at a time. An EventEmitter is universal (works in Node, Bun, Deno, browsers).

The TUI's SolidJS patterns map cleanly:
- `createStore({...})` → `this.state = {...}`
- `setStore("session", idx, reconcile(data))` → `this.state.session[idx] = data; this.emit("session", ...)`
- `produce(draft => draft.splice(i, 1))` → `this.state.array.splice(i, 1); this.emit(...)`

---

## Design Decision 2: Event Batching

### Keep TUI's 16ms batching?

**Yes.** The TUI batches events to prevent excessive re-renders. For headless use, batching prevents adapter callbacks from firing on every individual part delta (which can be hundreds per second during streaming). Adapters get fewer, larger batches — which is what they want for rate-limited channels like Mattermost (max ~10 edits/second).

The batching is in the SDK layer (client.ts), not the store. Store processes events as they arrive from the SDK batch.

---

## Design Decision 3: Permission/Question Handling in Router

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **Async callback (adapter returns Promise)** | Natural, blocking, type-safe | If adapter hangs, blocks everything for that session |
| Event-based (emit request, wait for reply event) | Non-blocking, flexible | More complex, requires correlation IDs |
| Hybrid (timeout + default) | Robust | Still needs timeout policy |

### Decision: **Async callback with timeout**

The router calls `adapter.onPermissionRequest()` which returns a Promise. The router wraps it with a configurable timeout (default: 5 minutes). On timeout, the router rejects the permission request automatically.

```typescript
const reply = await Promise.race([
  adapter.onPermissionRequest(sessionID, request),
  timeout(config.permissionTimeout).then(() => ({ reply: "reject" as const, message: "Timed out" }))
])
await client.permission.reply({ requestID: request.id, reply: reply.reply, message: reply.message })
```

---

## Design Decision 4: Message Completion Detection

### How does the TUI know a message is "complete"?

From `sync.tsx` session status derivation:
```typescript
if (session.time.compacting) return "compacting"
const last = messages.at(-1)
if (!last) return "idle"
if (last.role === "user") return "working"
return last.time.completed ? "idle" : "working"
```

The `message.time.completed` field is set by the server when the assistant finishes generating. The router watches for this transition (`working → idle`) and calls `onAssistantMessageComplete()`.

---

## Design Decision 5: SDK Dependency Strategy

### Options

| Option | Pros | Cons |
|--------|------|------|
| **Peer dependency on @opencode-ai/sdk** | Adapter can use same SDK version, no duplication | Consumer must install SDK separately |
| Bundled dependency | Self-contained install | Version conflicts if consumer also uses SDK |
| Re-generate types from OpenAPI spec | No SDK dependency at all | Maintenance burden, may drift |

### Decision: **Peer dependency**

`@opencode-ai/sdk` is a peer dependency. This ensures:
1. Types are shared between headless core and any adapter
2. No duplicate SDK code in node_modules
3. Consumer controls SDK version upgrades

```json
{
  "peerDependencies": {
    "@opencode-ai/sdk": "^1.2.0"
  }
}
```

---

## Design Decision 6: EventEmitter Implementation

### Options

| Option | Pros | Cons |
|--------|------|------|
| **Node.js EventEmitter** | Built-in, no deps, familiar | Type safety requires manual typing |
| mitt (200 bytes) | Tiny, typed, works everywhere | Extra dep (tiny) |
| Custom typed emitter | Exactly what we need, no deps | Maintenance burden |

### Decision: **Custom typed emitter (~30 lines)**

A minimal typed emitter that supports:
- `on(event, handler)` → `() => void` (unsubscribe)
- `emit(event, payload)` → void
- `off(event, handler)` → void
- Full TypeScript inference of event→payload mapping

This avoids the Node.js `events` module (not available in all runtimes without polyfill) and keeps the package truly zero-dependency beyond the SDK.
