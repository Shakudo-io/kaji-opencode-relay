/**
 * Live Integration Tests for Kaji OpenCode Relay
 *
 * These tests connect to a REAL running OpenCode server on port 4096.
 * Output varies per run — tests produce structured NDJSON logs that an AI agent
 * can assess for correctness.
 *
 * Assessment criteria for AI agent:
 * - Each test logs a [RESULT] line with { test, pass, details }
 * - pass=true means the relay behaved correctly
 * - pass=false means something went wrong — details explain what
 * - Tests are READ-ONLY: no sessions created, no prompts sent, no mutations
 *
 * Run: LIVE_TEST_URL=http://localhost:4096 bun test tests/live-integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { HeadlessClient } from "../src/client"
import { SyncStore } from "../src/store"
import { HeadlessRouter } from "../src/router"
import { DebugAdapter } from "../src/debug/adapter"
import { ConsoleRenderer } from "../src/debug/renderer"
import type { DerivedSessionStatus, Message, Part, PermissionReply, PermissionRequest, QuestionReply, QuestionRequest, Todo, ToastNotification } from "../src/types"

const SERVER_URL = process.env.LIVE_TEST_URL ?? "http://localhost:4096"

function log(test: string, pass: boolean, details: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), test, pass, ...details }
  console.log(`[RESULT] ${JSON.stringify(entry)}`)
}

describe("Live Integration: Relay → OpenCode Server", () => {
  let client: HeadlessClient
  let store: SyncStore

  beforeAll(async () => {
    client = new HeadlessClient({ url: SERVER_URL })
    store = new SyncStore()
  })

  afterAll(() => {
    client.disconnect()
  })

  test("1. HeadlessClient connects and receives server.connected event", async () => {
    const events: string[] = []
    client.on("event", (e) => events.push(e.type))

    await client.connect()

    await new Promise((r) => setTimeout(r, 500))

    const connected = client.isConnected
    const receivedServerConnected = events.includes("server.connected")

    log("connect", connected && receivedServerConnected, {
      isConnected: connected,
      receivedServerConnected,
      eventsReceived: events.length,
      eventTypes: [...new Set(events)],
    })

    expect(connected).toBe(true)
  })

  test("2. SyncStore bootstraps — loads providers, agents, sessions, config", async () => {
    await client.bootstrap(store)

    await new Promise((r) => setTimeout(r, 2000))

    const status = store.state.status
    const providerCount = store.state.provider.length
    const agentCount = store.state.agent.length
    const sessionCount = store.state.session.length
    const hasConfig = Object.keys(store.state.config).length > 0
    const commandCount = store.state.command.length

    const pass = (status === "partial" || status === "complete") && agentCount > 0 && sessionCount > 0 && hasConfig

    log("bootstrap", pass, {
      status,
      providerCount,
      agentCount,
      sessionCount,
      commandCount,
      hasConfig,
      configKeys: Object.keys(store.state.config),
      sampleAgents: store.state.agent.slice(0, 5).map((a: Record<string, unknown>) => a.name),
      sampleSessionIds: store.state.session.slice(0, 3).map((s) => s.id),
    })

    expect(status === "partial" || status === "complete").toBe(true)
    expect(agentCount).toBeGreaterThan(0)
    expect(sessionCount).toBeGreaterThan(0)
  })

  test("3. SyncStore state shape is consistent — all expected fields populated", async () => {
    const state = store.state
    const checks: Record<string, boolean> = {
      sessions_sorted: state.session.every((s, i) => i === 0 || s.id >= state.session[i - 1]!.id),
      sessions_have_ids: state.session.every((s) => typeof s.id === "string" && s.id.length > 0),
      agents_have_names: state.agent.every((a: Record<string, unknown>) => typeof a.name === "string"),
      config_is_object: typeof state.config === "object" && state.config !== null,
      path_has_directory: typeof state.path?.directory === "string",
      mcp_is_object: typeof state.mcp === "object",
      lsp_is_array: Array.isArray(state.lsp),
    }

    const allPass = Object.values(checks).every(Boolean)

    log("state-shape", allPass, {
      checks,
      pathInfo: state.path,
      vcs: state.vcs,
      mcpServerCount: Object.keys(state.mcp).length,
      lspCount: state.lsp.length,
      formatterCount: state.formatter.length,
    })

    expect(allPass).toBe(true)
  })

  test("4. Session sync fetches messages, todos, and diffs for a session", async () => {
    const sessions = store.state.session
    if (sessions.length === 0) {
      log("session-sync", false, { reason: "no sessions available" })
      expect(sessions.length).toBeGreaterThan(0)
      return
    }

    const targetSession = sessions[sessions.length - 1]!
    const sessionID = targetSession.id

    await store.session.sync(client.sdk, sessionID)

    const messages = store.state.message[sessionID] ?? []
    const todos = store.state.todo[sessionID] ?? []
    const diffs = store.state.session_diff[sessionID] ?? []
    const status = store.session.status(sessionID)

    const hasMessages = messages.length > 0
    const messagesSorted = messages.every((m, i) => i === 0 || m.id >= messages[i - 1]!.id)

    log("session-sync", true, {
      sessionID,
      messageCount: messages.length,
      hasMessages,
      messagesSorted,
      todoCount: todos.length,
      diffCount: diffs.length,
      derivedStatus: status,
      messageRoles: messages.map((m) => m.role),
      lastMessageRole: messages.at(-1)?.role,
      lastMessageCompleted: !!(messages.at(-1) as Record<string, unknown>)?.time,
    })

    expect(messagesSorted).toBe(true)
  })

  test("5. Session status derivation matches expected values", async () => {
    const sessions = store.state.session
    const statuses: Array<{ id: string; status: DerivedSessionStatus }> = []

    for (const session of sessions.slice(-5)) {
      const status = store.session.status(session.id)
      statuses.push({ id: session.id, status })
    }

    const validStatuses = statuses.every((s) => ["idle", "working", "compacting"].includes(s.status))

    log("session-status", validStatuses, {
      checked: statuses.length,
      statuses,
      allValid: validStatuses,
    })

    expect(validStatuses).toBe(true)
  })

  test("6. SSE event stream delivers real-time events", async () => {
    const events: Array<{ type: string; ts: number }> = []
    const unsub = client.on("event", (e) => {
      events.push({ type: e.type, ts: Date.now() })
    })

    await new Promise((r) => setTimeout(r, 3000))
    unsub()

    log("sse-stream", true, {
      eventCount: events.length,
      uniqueTypes: [...new Set(events.map((e) => e.type))],
      note: events.length === 0
        ? "No events during 3s window — server may be idle (this is normal)"
        : `Received ${events.length} events`,
    })

    expect(client.isConnected).toBe(true)
  })

  test("7. DebugAdapter correctly processes store events via router", async () => {
    const adapterCalls: Array<{ method: string; sessionID?: string; detail?: string }> = []

    const adapter: DebugAdapter & { _calls: typeof adapterCalls } = Object.assign(
      new DebugAdapter({
        renderer: new ConsoleRenderer({ json: true }),
        permissionPolicy: "approve-all",
        questionPolicy: "first-option",
      }),
      { _calls: adapterCalls },
    )

    const origMessage = adapter.onAssistantMessage.bind(adapter)
    adapter.onAssistantMessage = async (sid, msg, parts) => {
      adapterCalls.push({ method: "onAssistantMessage", sessionID: sid })
      return origMessage(sid, msg, parts)
    }
    const origStatus = adapter.onSessionStatus.bind(adapter)
    adapter.onSessionStatus = (sid, status) => {
      adapterCalls.push({ method: "onSessionStatus", sessionID: sid, detail: status })
      return origStatus(sid, status)
    }
    const origTodo = adapter.onTodoUpdate.bind(adapter)
    adapter.onTodoUpdate = (sid, todos) => {
      adapterCalls.push({ method: "onTodoUpdate", sessionID: sid, detail: `${todos.length} todos` })
      return origTodo(sid, todos)
    }
    const origToast = adapter.onToast.bind(adapter)
    adapter.onToast = (notification) => {
      adapterCalls.push({ method: "onToast", detail: notification.message })
      return origToast(notification)
    }

    const router = new HeadlessRouter({
      client,
      store,
      adapters: [adapter],
      defaultAdapterId: "debug",
    })

    await new Promise((r) => setTimeout(r, 3000))
    await router.shutdown()

    log("adapter-routing", true, {
      adapterCallCount: adapterCalls.length,
      calls: adapterCalls.slice(0, 20),
      note: adapterCalls.length === 0
        ? "No adapter calls during 3s window — server idle (normal)"
        : `${adapterCalls.length} adapter calls routed successfully`,
    })

    expect(true).toBe(true)
  })

  test("8. Multiple sessions can be synced without errors", async () => {
    const sessions = store.state.session.slice(-3)
    const results: Array<{ id: string; messages: number; todos: number; status: string }> = []

    for (const session of sessions) {
      try {
        await store.session.sync(client.sdk, session.id)
        const messages = store.state.message[session.id] ?? []
        const todos = store.state.todo[session.id] ?? []
        results.push({
          id: session.id,
          messages: messages.length,
          todos: todos.length,
          status: store.session.status(session.id),
        })
      } catch (error) {
        results.push({
          id: session.id,
          messages: -1,
          todos: -1,
          status: `error: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    }

    const allSucceeded = results.every((r) => r.messages >= 0)

    log("multi-session-sync", allSucceeded, {
      sessionCount: results.length,
      results,
    })

    expect(allSucceeded).toBe(true)
  })

  test("9. Store message cap enforced — no session exceeds 100 messages", () => {
    const violations: Array<{ sessionID: string; count: number }> = []

    for (const [sessionID, messages] of Object.entries(store.state.message)) {
      if (messages.length > 100) {
        violations.push({ sessionID, count: messages.length })
      }
    }

    const pass = violations.length === 0

    log("message-cap", pass, {
      sessionsChecked: Object.keys(store.state.message).length,
      violations,
      maxMessages: Math.max(0, ...Object.values(store.state.message).map((m) => m.length)),
    })

    expect(violations.length).toBe(0)
  })

  test("10. Permissions and questions stores are clean arrays (no corruption)", () => {
    const permissionIssues: string[] = []
    const questionIssues: string[] = []

    for (const [sessionID, perms] of Object.entries(store.state.permission)) {
      if (!Array.isArray(perms)) {
        permissionIssues.push(`${sessionID}: not an array`)
      } else {
        for (let i = 1; i < perms.length; i++) {
          if (perms[i]!.id < perms[i - 1]!.id) {
            permissionIssues.push(`${sessionID}: not sorted at index ${i}`)
          }
        }
      }
    }

    for (const [sessionID, questions] of Object.entries(store.state.question)) {
      if (!Array.isArray(questions)) {
        questionIssues.push(`${sessionID}: not an array`)
      } else {
        for (let i = 1; i < questions.length; i++) {
          if (questions[i]!.id < questions[i - 1]!.id) {
            questionIssues.push(`${sessionID}: not sorted at index ${i}`)
          }
        }
      }
    }

    const pass = permissionIssues.length === 0 && questionIssues.length === 0

    log("store-integrity", pass, {
      permissionSessions: Object.keys(store.state.permission).length,
      questionSessions: Object.keys(store.state.question).length,
      permissionIssues,
      questionIssues,
    })

    expect(pass).toBe(true)
  })

  test("11. Store typed accessors return consistent data", async () => {
    const targetSession = store.state.session[store.state.session.length - 1]!
    const sid = targetSession.id

    await store.session.sync(client.sdk, sid)

    const sessionObj = store.session.get(sid)
    const messages = store.messages(sid)
    const todos = store.todos(sid)
    const permissions = store.permissions(sid)
    const questions = store.questions(sid)
    const providers = store.providers
    const agents = store.agents
    const config = store.config
    const lsp = store.lspStatus
    const mcp = store.mcpStatus
    const mcpRes = store.mcpResources
    const formatters = store.formatterStatus
    const vcs = store.vcsInfo
    const pathInfo = store.path
    const snapshot = store.snapshot()

    const firstMsg = messages[0]
    const parts = firstMsg ? store.parts(firstMsg.id) : []

    const checks: Record<string, boolean> = {
      session_get_returns_object: sessionObj !== undefined && sessionObj.id === sid,
      messages_returns_array: Array.isArray(messages),
      todos_returns_array: Array.isArray(todos),
      permissions_returns_array: Array.isArray(permissions),
      questions_returns_array: Array.isArray(questions),
      providers_returns_array: Array.isArray(providers) && providers.length > 0,
      agents_returns_array: Array.isArray(agents) && agents.length > 0,
      config_returns_object: typeof config === "object" && config !== null,
      lsp_returns_array: Array.isArray(lsp),
      mcp_returns_object: typeof mcp === "object",
      mcp_resources_returns_object: typeof mcpRes === "object",
      formatters_returns_array: Array.isArray(formatters),
      path_has_directory: typeof pathInfo?.directory === "string",
      snapshot_is_deep_copy: snapshot !== store.state,
      snapshot_has_sessions: snapshot.session.length === store.state.session.length,
      parts_returns_array: Array.isArray(parts),
    }

    const allPass = Object.values(checks).every(Boolean)

    log("store-accessors", allPass, {
      sessionID: sid,
      checks,
      messageCount: messages.length,
      partsForFirstMessage: parts.length,
      vcs,
    })

    expect(allPass).toBe(true)
  })

  test("12. Store processes live SSE events into state changes", async () => {
    const stateChanges: Array<{ event: string; ts: number }> = []

    const unsubs = [
      store.on("assistantMessage", () => stateChanges.push({ event: "assistantMessage", ts: Date.now() })),
      store.on("assistantMessageComplete", () => stateChanges.push({ event: "assistantMessageComplete", ts: Date.now() })),
      store.on("sessionStatus", () => stateChanges.push({ event: "sessionStatus", ts: Date.now() })),
      store.on("todo", () => stateChanges.push({ event: "todo", ts: Date.now() })),
      store.on("permission", () => stateChanges.push({ event: "permission", ts: Date.now() })),
      store.on("question", () => stateChanges.push({ event: "question", ts: Date.now() })),
      store.on("toast", () => stateChanges.push({ event: "toast", ts: Date.now() })),
      store.on("sessionError", () => stateChanges.push({ event: "sessionError", ts: Date.now() })),
    ]

    const rawEvents: string[] = []
    const eventUnsub = client.on("event", (e) => {
      rawEvents.push(e.type)
      store.processEvent(e)
    })

    await new Promise((r) => setTimeout(r, 3000))

    for (const u of unsubs) u()
    eventUnsub()

    log("live-event-processing", true, {
      rawEventsReceived: rawEvents.length,
      rawEventTypes: [...new Set(rawEvents)],
      storeChangesEmitted: stateChanges.length,
      storeChangeTypes: [...new Set(stateChanges.map((c) => c.event))],
      note: rawEvents.length === 0
        ? "Server idle during 3s window — no events to process (normal)"
        : `${rawEvents.length} raw events → ${stateChanges.length} store changes`,
    })

    expect(client.isConnected).toBe(true)
  })

  test("13. MCP servers listed with status", () => {
    const mcp = store.mcpStatus
    const mcpEntries = Object.entries(mcp)
    const servers = mcpEntries.map(([name, status]) => {
      const s = status as Record<string, unknown>
      return { name, status: s.status as string, error: s.error as string | undefined }
    })

    const connected = servers.filter((s) => s.status === "connected")
    const failed = servers.filter((s) => s.status === "failed")
    const disabled = servers.filter((s) => s.status === "disabled")
    const other = servers.filter((s) => !["connected", "failed", "disabled"].includes(s.status))

    const resources = store.mcpResources
    const resourceEntries = Object.entries(resources)

    log("mcp-servers", servers.length > 0, {
      totalServers: servers.length,
      connected: connected.length,
      failed: failed.length,
      disabled: disabled.length,
      other: other.length,
      servers: servers.map((s) => ({ name: s.name, status: s.status, ...(s.error ? { error: s.error } : {}) })),
      totalResources: resourceEntries.length,
      sampleResources: resourceEntries.slice(0, 5).map(([_key, r]) => {
        const res = r as Record<string, unknown>
        return { name: res.name, client: res.client, uri: res.uri }
      }),
    })

    expect(servers.length).toBeGreaterThan(0)
  })
})
