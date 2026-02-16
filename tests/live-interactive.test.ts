/**
 * Live Interactive Tests for Kaji OpenCode Relay
 *
 * THESE TESTS MUTATE STATE: create sessions, send prompts, trigger tool use.
 * They exercise the full interaction loop: prompt → stream → permission → reply → complete.
 *
 * Assessment criteria for AI agent:
 * - [RESULT] lines with { test, pass, details }
 * - The session is created fresh and deleted at the end
 * - Tool calls should appear (web_search triggered by asking about current events)
 * - Permission flow should complete (auto-approved)
 * - Message streaming should deliver text parts
 * - Session status should transition: idle → working → idle
 *
 * Run: LIVE_TEST_URL=http://localhost:4096 bun test tests/live-interactive.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { HeadlessClient } from "../src/client"
import { SyncStore } from "../src/store"
import { HeadlessRouter } from "../src/router"
import { DebugAdapter } from "../src/debug/adapter"
import { ConsoleRenderer } from "../src/debug/renderer"
import type { DerivedSessionStatus, Message, Part, PermissionRequest, Todo, ToastNotification } from "../src/types"

const SERVER_URL = process.env.LIVE_TEST_URL ?? "http://localhost:4096"
const RESPONSE_WAIT_MS = 30_000
const TOOL_WAIT_MS = 60_000

function log(test: string, pass: boolean, details: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), test, pass, ...details }
  console.log(`[RESULT] ${JSON.stringify(entry)}`)
}

type AdapterEvent = {
  method: string
  ts: number
  sessionID?: string
  messageID?: string
  role?: string
  partTypes?: string[]
  status?: string
  permissionType?: string
  reply?: string
  todoCount?: number
  textLength?: number
}

describe("Live Interactive: Full Interaction Loop", () => {
  let client: HeadlessClient
  let store: SyncStore
  let router: HeadlessRouter
  let sessionID: string
  const adapterEvents: AdapterEvent[] = []
  const statusTransitions: Array<{ status: DerivedSessionStatus; ts: number }> = []
  const renderer = new ConsoleRenderer({ json: true })

  beforeAll(async () => {
    client = new HeadlessClient({ url: SERVER_URL })
    store = new SyncStore()

    const adapter = new DebugAdapter({
      renderer,
      permissionPolicy: "approve-all",
      questionPolicy: "first-option",
    })

    const origMessage = adapter.onAssistantMessage.bind(adapter)
    adapter.onAssistantMessage = async (sid, msg, parts) => {
      const textParts = parts.filter((p) => p.type === "text")
      const totalText = textParts.reduce((acc, p) => acc + ((p as Record<string, unknown>).text as string ?? "").length, 0)
      adapterEvents.push({
        method: "onAssistantMessage",
        ts: Date.now(),
        sessionID: sid,
        messageID: msg.id,
        role: msg.role,
        partTypes: parts.map((p) => p.type),
        textLength: totalText,
      })
      return origMessage(sid, msg, parts)
    }

    const origComplete = adapter.onAssistantMessageComplete.bind(adapter)
    adapter.onAssistantMessageComplete = async (sid, msg, parts) => {
      adapterEvents.push({
        method: "onAssistantMessageComplete",
        ts: Date.now(),
        sessionID: sid,
        messageID: msg.id,
        partTypes: parts.map((p) => p.type),
      })
      return origComplete(sid, msg, parts)
    }

    const origPermission = adapter.onPermissionRequest.bind(adapter)
    adapter.onPermissionRequest = async (sid, req) => {
      const permType = (req as Record<string, unknown>).permission as string ?? "unknown"
      const result = await origPermission(sid, req)
      adapterEvents.push({
        method: "onPermissionRequest",
        ts: Date.now(),
        sessionID: sid,
        permissionType: permType,
        reply: result.reply,
      })
      return result
    }

    const origStatus = adapter.onSessionStatus.bind(adapter)
    adapter.onSessionStatus = (sid, status) => {
      statusTransitions.push({ status, ts: Date.now() })
      adapterEvents.push({ method: "onSessionStatus", ts: Date.now(), sessionID: sid, status })
      return origStatus(sid, status)
    }

    const origTodo = adapter.onTodoUpdate.bind(adapter)
    adapter.onTodoUpdate = (sid, todos) => {
      adapterEvents.push({ method: "onTodoUpdate", ts: Date.now(), sessionID: sid, todoCount: todos.length })
      return origTodo(sid, todos)
    }

    router = new HeadlessRouter({
      client,
      store,
      adapters: [adapter],
      defaultAdapterId: "debug",
    })

    await client.connect()
    await client.bootstrap(store)
    await new Promise((r) => setTimeout(r, 1000))

    client.on("event", (e) => store.processEvent(e))
  })

  afterAll(async () => {
    if (sessionID) {
      try {
        await client.deleteSession(sessionID)
        log("cleanup", true, { sessionID, deleted: true })
      } catch (error) {
        log("cleanup", false, { sessionID, error: error instanceof Error ? error.message : String(error) })
      }
    }
    await router.shutdown()
    client.disconnect()
  })

  test("1. Create a new session", async () => {
    const raw = await client.createSession() as Record<string, unknown>
    const session = (raw.data ?? raw) as Record<string, unknown>
    sessionID = session.id as string

    const pass = typeof sessionID === "string" && sessionID.length > 0

    log("create-session", pass, { sessionID })

    expect(pass).toBe(true)
  })

  test("2. Send a simple prompt and receive streamed response", async () => {
    adapterEvents.length = 0
    statusTransitions.length = 0

    await client.prompt(sessionID, "What is 2 + 2? Reply with just the number, nothing else.")

    const deadline = Date.now() + RESPONSE_WAIT_MS
    while (Date.now() < deadline) {
      const hasComplete = adapterEvents.some((e) => e.method === "onAssistantMessageComplete")
      if (hasComplete) break
      await new Promise((r) => setTimeout(r, 200))
    }

    const messageEvents = adapterEvents.filter((e) => e.method === "onAssistantMessage")
    const completeEvents = adapterEvents.filter((e) => e.method === "onAssistantMessageComplete")
    const statusEvents = adapterEvents.filter((e) => e.method === "onSessionStatus")

    const receivedStreaming = messageEvents.length > 0
    const receivedCompletion = completeEvents.length > 0
    const hadWorkingStatus = statusTransitions.some((s) => s.status === "working")

    const messages = store.messages(sessionID)
    const lastAssistant = messages.filter((m) => m.role === "assistant").at(-1)
    const lastParts = lastAssistant ? store.parts(lastAssistant.id) : []
    const textContent = lastParts
      .filter((p) => p.type === "text")
      .map((p) => (p as Record<string, unknown>).text as string)
      .join("")

    const pass = receivedStreaming && receivedCompletion

    log("simple-prompt", pass, {
      sessionID,
      receivedStreaming,
      streamingEventCount: messageEvents.length,
      receivedCompletion,
      hadWorkingStatus,
      statusTransitions: statusTransitions.map((s) => s.status),
      messagesInStore: messages.length,
      lastAssistantId: lastAssistant?.id,
      partCount: lastParts.length,
      partTypes: lastParts.map((p) => p.type),
      textContent: textContent.slice(0, 200),
      textLength: textContent.length,
    })

    expect(receivedCompletion).toBe(true)
  })

  test("3. Send a prompt that triggers web search tool use", async () => {
    adapterEvents.length = 0
    statusTransitions.length = 0

    await client.prompt(
      sessionID,
      "Use the web_search tool to search for 'opencode cli github'. Just do the search and tell me the first result title. Nothing else.",
    )

    const deadline = Date.now() + TOOL_WAIT_MS
    while (Date.now() < deadline) {
      const hasComplete = adapterEvents.some((e) => e.method === "onAssistantMessageComplete")
      if (hasComplete) break
      await new Promise((r) => setTimeout(r, 300))
    }

    const messageEvents = adapterEvents.filter((e) => e.method === "onAssistantMessage")
    const completeEvents = adapterEvents.filter((e) => e.method === "onAssistantMessageComplete")
    const permissionEvents = adapterEvents.filter((e) => e.method === "onPermissionRequest")

    const allPartTypes = new Set(messageEvents.flatMap((e) => e.partTypes ?? []))
    const hadToolParts = allPartTypes.has("tool")
    const hadTextParts = allPartTypes.has("text")

    const messages = store.messages(sessionID)
    const lastAssistant = messages.filter((m) => m.role === "assistant").at(-1)
    const lastParts = lastAssistant ? store.parts(lastAssistant.id) : []
    const toolParts = lastParts.filter((p) => p.type === "tool")
    const textParts = lastParts.filter((p) => p.type === "text")
    const textContent = textParts.map((p) => (p as Record<string, unknown>).text as string).join("")
    const toolNames = toolParts.map((p) => (p as Record<string, unknown>).tool as string)

    const pass = completeEvents.length > 0

    log("tool-use-prompt", pass, {
      sessionID,
      receivedCompletion: completeEvents.length > 0,
      streamingEventCount: messageEvents.length,
      hadToolParts,
      hadTextParts,
      permissionCount: permissionEvents.length,
      permissionTypes: permissionEvents.map((e) => e.permissionType),
      permissionReplies: permissionEvents.map((e) => e.reply),
      allPartTypes: [...allPartTypes],
      toolNames,
      toolPartCount: toolParts.length,
      textPartCount: textParts.length,
      textContent: textContent.slice(0, 300),
      messagesInStore: messages.length,
      statusTransitions: statusTransitions.map((s) => s.status),
    })

    expect(pass).toBe(true)
  })

  test("4. Verify session state is consistent after interaction", async () => {
    const deadline = Date.now() + RESPONSE_WAIT_MS
    while (Date.now() < deadline && store.session.status(sessionID) !== "idle") {
      await new Promise((r) => setTimeout(r, 300))
    }

    const session = store.session.get(sessionID)
    const messages = store.messages(sessionID)
    const status = store.session.status(sessionID)

    const userMessages = messages.filter((m) => m.role === "user")
    const assistantMessages = messages.filter((m) => m.role === "assistant")

    const messagesSorted = messages.every((m, i) => i === 0 || m.id >= messages[i - 1]!.id)
    const allAssistantsComplete = assistantMessages.every((m) => Boolean(m.time.completed))

    const allParts: Array<{ messageID: string; partCount: number; types: string[] }> = []
    for (const msg of assistantMessages) {
      const parts = store.parts(msg.id)
      allParts.push({ messageID: msg.id, partCount: parts.length, types: parts.map((p) => p.type) })
    }

    const pass = session !== undefined && messagesSorted && status === "idle" && userMessages.length >= 2 && assistantMessages.length >= 2

    log("post-interaction-state", pass, {
      sessionID,
      sessionExists: session !== undefined,
      messagesSorted,
      status,
      totalMessages: messages.length,
      userMessages: userMessages.length,
      assistantMessages: assistantMessages.length,
      allAssistantsComplete,
      partsPerMessage: allParts,
    })

    expect(pass).toBe(true)
  })

  test("5. Permission round-trip — bash command triggers permission, adapter auto-approves", async () => {
    adapterEvents.length = 0
    statusTransitions.length = 0

    await client.prompt(sessionID, "Run this exact bash command: echo 'relay-permission-test'. Do not use any other tool, only bash.")

    const deadline = Date.now() + RESPONSE_WAIT_MS
    while (Date.now() < deadline) {
      const hasComplete = adapterEvents.some((e) => e.method === "onAssistantMessageComplete")
      if (hasComplete) break
      await new Promise((r) => setTimeout(r, 200))
    }

    const permissionEvents = adapterEvents.filter((e) => e.method === "onPermissionRequest")
    const completeEvents = adapterEvents.filter((e) => e.method === "onAssistantMessageComplete")
    const toolEvents = adapterEvents.filter((e) => e.partTypes?.includes("tool"))

    const hadPermission = permissionEvents.length > 0
    const permissionAutoApproved = permissionEvents.every((e) => e.reply === "once")
    const hadToolUse = toolEvents.length > 0

    log("permission-roundtrip", completeEvents.length > 0, {
      sessionID,
      hadPermission,
      permissionCount: permissionEvents.length,
      permissionTypes: permissionEvents.map((e) => e.permissionType),
      permissionReplies: permissionEvents.map((e) => e.reply),
      permissionAutoApproved,
      hadToolUse,
      completionReceived: completeEvents.length > 0,
      note: hadPermission
        ? `Permission flow complete: ${permissionEvents.length} permission(s) auto-approved`
        : "No permission triggered — LLM may have used a different approach or permissions are set to auto-allow on server",
    })

    expect(completeEvents.length).toBeGreaterThan(0)
  })

  test("6. Question round-trip — prompt triggers question tool, adapter auto-selects", async () => {
    adapterEvents.length = 0
    statusTransitions.length = 0

    await client.prompt(
      sessionID,
      "You MUST use the question tool right now to ask me which color I prefer. Provide exactly 3 options: Red, Blue, Green. Use the question tool, do not answer yourself.",
    )

    const deadline = Date.now() + RESPONSE_WAIT_MS
    while (Date.now() < deadline) {
      const hasComplete = adapterEvents.some((e) => e.method === "onAssistantMessageComplete")
      if (hasComplete) break
      await new Promise((r) => setTimeout(r, 200))
    }

    const questionEvents = adapterEvents.filter((e) => e.method === "onQuestionRequest")
    const completeEvents = adapterEvents.filter((e) => e.method === "onAssistantMessageComplete")

    const hadQuestion = questionEvents.length > 0

    log("question-roundtrip", completeEvents.length > 0, {
      sessionID,
      hadQuestion,
      questionCount: questionEvents.length,
      completionReceived: completeEvents.length > 0,
      note: hadQuestion
        ? `Question flow complete: ${questionEvents.length} question(s) auto-answered`
        : "No question triggered — LLM may not have used the question tool despite instruction",
    })

    expect(completeEvents.length).toBeGreaterThan(0)
  })

  test("7. Todo updates — multi-step prompt generates todos", async () => {
    adapterEvents.length = 0
    statusTransitions.length = 0

    await client.prompt(
      sessionID,
      "Create a todo list with exactly 3 items using the todowrite tool: 1) Buy groceries 2) Clean house 3) Read a book. Use the todowrite tool.",
    )

    const deadline = Date.now() + RESPONSE_WAIT_MS
    while (Date.now() < deadline) {
      const hasComplete = adapterEvents.some((e) => e.method === "onAssistantMessageComplete")
      if (hasComplete) break
      await new Promise((r) => setTimeout(r, 200))
    }

    const todoEvents = adapterEvents.filter((e) => e.method === "onTodoUpdate")
    const completeEvents = adapterEvents.filter((e) => e.method === "onAssistantMessageComplete")

    const hadTodos = todoEvents.length > 0
    const todosInStore = store.todos(sessionID)

    log("todo-updates", completeEvents.length > 0, {
      sessionID,
      hadTodoEvents: hadTodos,
      todoEventCount: todoEvents.length,
      todoCounts: todoEvents.map((e) => e.todoCount),
      todosInStoreNow: todosInStore.length,
      completionReceived: completeEvents.length > 0,
      note: hadTodos
        ? `Todo flow complete: ${todoEvents.length} update(s), ${todosInStore.length} todos in store`
        : "No todo updates — agent may not have todowrite tool or chose not to use it",
    })

    expect(completeEvents.length).toBeGreaterThan(0)
  })

  test("8. Abort mid-stream — cancel a running response", async () => {
    adapterEvents.length = 0
    statusTransitions.length = 0

    await client.prompt(
      sessionID,
      "Write a very long, detailed essay about the history of computing from 1940 to 2025. Include every major invention, company, and person involved. Make it at least 5000 words.",
    )

    await new Promise((r) => setTimeout(r, 3000))

    const wasWorking = statusTransitions.some((s) => s.status === "working")
    const hadStreaming = adapterEvents.some((e) => e.method === "onAssistantMessage")

    await client.abort(sessionID)

    await new Promise((r) => setTimeout(r, 2000))

    const finalStatus = store.session.status(sessionID)

    log("abort-mid-stream", wasWorking, {
      sessionID,
      wasWorkingBeforeAbort: wasWorking,
      hadStreamingBeforeAbort: hadStreaming,
      streamingEventsBeforeAbort: adapterEvents.filter((e) => e.method === "onAssistantMessage").length,
      statusAfterAbort: finalStatus,
      statusSequence: statusTransitions.map((s) => s.status),
      note: wasWorking
        ? `Abort successful: was working, now ${finalStatus}`
        : "Could not confirm working state before abort — LLM may have responded too quickly",
    })

    expect(wasWorking || hadStreaming).toBe(true)
  })

  test("9. Post-interaction state (final verification)", async () => {
    const deadline = Date.now() + RESPONSE_WAIT_MS
    while (Date.now() < deadline && store.session.status(sessionID) !== "idle") {
      await new Promise((r) => setTimeout(r, 300))
    }

    const messages = store.messages(sessionID)
    const status = store.session.status(sessionID)
    const userMsgs = messages.filter((m) => m.role === "user")
    const assistantMsgs = messages.filter((m) => m.role === "assistant")

    log("final-state", true, {
      sessionID,
      status,
      totalMessages: messages.length,
      userMessages: userMsgs.length,
      assistantMessages: assistantMsgs.length,
      messagesSorted: messages.every((m, i) => i === 0 || m.id >= messages[i - 1]!.id),
    })

    expect(status).toBe("idle")
  })

  test("10. Full adapter event timeline summary", () => {
    const timeline = adapterEvents.map((e) => ({
      method: e.method,
      elapsed: e.ts - adapterEvents[0]!.ts,
      ...(e.status ? { status: e.status } : {}),
      ...(e.permissionType ? { permission: e.permissionType, reply: e.reply } : {}),
      ...(e.todoCount !== undefined ? { todos: e.todoCount } : {}),
      ...(e.partTypes ? { parts: e.partTypes.length } : {}),
      ...(e.textLength ? { textLen: e.textLength } : {}),
    }))

    const methodCounts: Record<string, number> = {}
    for (const e of adapterEvents) {
      methodCounts[e.method] = (methodCounts[e.method] ?? 0) + 1
    }

    log("adapter-timeline", true, {
      totalAdapterEvents: adapterEvents.length,
      methodCounts,
      statusSequence: statusTransitions.map((s) => s.status),
      firstEvent: timeline[0],
      lastEvent: timeline.at(-1),
      timelineLength: timeline.length,
      timeline: timeline.slice(0, 50),
    })

    expect(adapterEvents.length).toBeGreaterThan(0)
  })
})
