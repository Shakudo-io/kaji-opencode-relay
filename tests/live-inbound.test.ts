/**
 * Live Integration Tests: Inbound Message Support & Origin Tracking
 *
 * Tests the new ChannelAdapter inbound extensions against a REAL OpenCode server.
 * Output is natural language — designed for human inspection.
 *
 * Run: LIVE_TEST_URL=http://localhost:4096 bun test tests/live-inbound.test.ts --timeout 60000
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { HeadlessClient } from "../src/client"
import { SyncStore } from "../src/store"
import { HeadlessRouter } from "../src/router"
import { DebugAdapter } from "../src/debug/adapter"
import { ConsoleRenderer } from "../src/debug/renderer"
import type { ChannelAdapter } from "../src/adapter"
import type { MessageOrigin, SessionInfo } from "../src/types"

const SERVER_URL = process.env.LIVE_TEST_URL ?? "http://localhost:4096"
const WAIT_MS = 20000

function narrate(testName: string, pass: boolean, description: string, details?: Record<string, unknown>) {
  const status = pass ? "✅ PASS" : "❌ FAIL"
  console.log(`\n${status} — ${testName}`)
  console.log(`  ${description}`)
  if (details) {
    for (const [key, value] of Object.entries(details)) {
      console.log(`  ${key}: ${JSON.stringify(value)}`)
    }
  }
}

async function waitFor(condition: () => boolean, timeoutMs = WAIT_MS, intervalMs = 200): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return true
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return false
}

const createAdapter = (id: string, channel: string): ChannelAdapter => ({
  id,
  channel,
  capabilities: {
    streaming: false,
    richFormatting: false,
    interactiveButtons: false,
    fileUpload: false,
    diffViewer: false,
    codeBlocks: false,
  },
  onAssistantMessage: async () => undefined,
  onAssistantMessageComplete: async () => undefined,
  onPermissionRequest: async () => ({ reply: "once" }),
  onQuestionRequest: async () => ({ rejected: true }),
  onSessionStatus: () => undefined,
  onTodoUpdate: () => undefined,
  onSessionError: () => undefined,
  onToast: () => undefined,
})

class RecordingDebugAdapter extends DebugAdapter {
  inboundEvents: Array<{ sessionID: string; text: string; origin: MessageOrigin }> = []
  sessionCreatedEvents: SessionInfo[] = []

  async onInboundMessage(sessionID: string, text: string, origin: MessageOrigin): Promise<void> {
    this.inboundEvents.push({ sessionID, text, origin })
    return super.onInboundMessage(sessionID, text, origin)
  }

  async onSessionCreated(sessionID: string, session: SessionInfo): Promise<void> {
    this.sessionCreatedEvents.push(session)
    return super.onSessionCreated(sessionID, session)
  }
}

describe("Live Inbound: Origin Tracking & Cross-Adapter Visibility", () => {
  let client: HeadlessClient
  let store: SyncStore
  let router: HeadlessRouter
  let adapter: RecordingDebugAdapter
  let eventUnsub: (() => void) | undefined
  const renderEvents: Array<{ tag: string; message: string }> = []

  beforeAll(async () => {
    const renderer = new ConsoleRenderer({ color: false, json: false, verbose: false })
    const originalRender = renderer.render.bind(renderer)
    renderer.render = (tag: string, message: string, details?: Record<string, unknown>) => {
      renderEvents.push({ tag, message })
      originalRender(tag, message, details)
    }

    adapter = new RecordingDebugAdapter({ renderer, store: undefined, permissionPolicy: "approve-all", questionPolicy: "first-option" })
    client = new HeadlessClient({ url: SERVER_URL })
    store = new SyncStore()

    const originAdapter = createAdapter("origin", "origin-channel")
    router = new HeadlessRouter({ client, store, adapters: [adapter, originAdapter], defaultAdapterId: adapter.id })

    await client.connect()
    await client.bootstrap(store)
    await new Promise((r) => setTimeout(r, 1000))

    eventUnsub = client.on("event", (event) => store.processEvent(event))
  })

  afterAll(async () => {
    if (eventUnsub) eventUnsub()
    await router.shutdown()
    client.disconnect()
  })

  test("1. SyncStore emits userMessage event when a prompt is sent", async () => {
    const raw = await client.createSession() as Record<string, unknown>
    const session = (raw.data ?? raw) as Record<string, unknown>
    const sessionID = session.id as string
    const shortId = sessionID.slice(0, 8)
    router.setSessionAdapter(sessionID, adapter.id)

    const received: Array<{ sessionID: string; messageId: string; role: string }> = []
    const unsub = store.on("userMessage", ({ sessionID: sid, message }) => {
      if (sid === sessionID) {
        received.push({ sessionID: sid, messageId: message.id, role: message.role })
      }
    })

    const promptText = "Say hello in exactly 3 words."
    await client.prompt(sessionID, promptText)

    const pass = await waitFor(() => received.length > 0)
    unsub()

    narrate(
      "userMessage event fires on prompt",
      pass,
      pass
        ? `Received userMessage for session ${shortId}. Message ID: ${received[0]?.messageId?.slice(0, 8)}.`
        : `No userMessage event received within ${WAIT_MS / 1000}s.`,
      { sessionID: shortId, receivedCount: received.length, prompt: promptText }
    )

    expect(pass).toBe(true)
    await client.deleteSession(sessionID).catch(() => undefined)
  })

  test("2. onSessionCreated fires when a new session is created", async () => {
    adapter.sessionCreatedEvents.length = 0

    const raw = await client.createSession() as Record<string, unknown>
    const session = (raw.data ?? raw) as Record<string, unknown>
    const sessionID = session.id as string
    const shortId = sessionID.slice(0, 8)

    const pass = await waitFor(() => adapter.sessionCreatedEvents.some((s) => s.sessionId === sessionID))
    const matching = adapter.sessionCreatedEvents.find((s) => s.sessionId === sessionID)

    narrate(
      "onSessionCreated fires on session creation",
      pass,
      pass
        ? `Adapter received sessionCreated for ${shortId}. Project: ${matching?.projectName ?? "unknown"}, dir: ${matching?.directory ?? "unknown"}.`
        : `No onSessionCreated callback within ${WAIT_MS / 1000}s.`,
      { sessionID: shortId, sessionInfo: matching }
    )

    expect(pass).toBe(true)
    await client.deleteSession(sessionID).catch(() => undefined)
  })

  test("3. Origin tracking works for adapter-originated prompts", async () => {
    adapter.inboundEvents.length = 0

    const raw = await client.createSession() as Record<string, unknown>
    const session = (raw.data ?? raw) as Record<string, unknown>
    const sessionID = session.id as string
    const shortId = sessionID.slice(0, 8)
    router.setSessionAdapter(sessionID, adapter.id)

    const promptText = "Respond with OK."
    await router.promptWithOrigin(sessionID, promptText, "origin")

    const pass = await waitFor(() => adapter.inboundEvents.some((e) => e.sessionID === sessionID))
    const inbound = adapter.inboundEvents.find((e) => e.sessionID === sessionID)

    const originMatches = inbound?.origin.adapterId === "origin"
    const finalPass = pass && originMatches

    narrate(
      "origin tracking via promptWithOrigin",
      finalPass,
      finalPass
        ? `Inbound message received with origin adapterId="origin" for session ${shortId}.`
        : `Inbound message missing or origin mismatch. Received: ${JSON.stringify(inbound?.origin)}`,
      { sessionID: shortId, origin: inbound?.origin, textSample: inbound?.text?.slice(0, 80) }
    )

    expect(finalPass).toBe(true)
    await client.deleteSession(sessionID).catch(() => undefined)
  })

  test("4. Debug adapter produces readable output", async () => {
    renderEvents.length = 0

    const raw = await client.createSession() as Record<string, unknown>
    const session = (raw.data ?? raw) as Record<string, unknown>
    const sessionID = session.id as string
    const shortId = sessionID.slice(0, 8)
    router.setSessionAdapter(sessionID, adapter.id)

    await router.promptWithOrigin(sessionID, "List the first 3 files in the current directory.", adapter.id)

    const pass = await waitFor(() => renderEvents.some((e) => e.tag === "TEXT") && renderEvents.some((e) => e.tag === "COMPLETE"))
    const samples = renderEvents.slice(0, 5).map((e) => `${e.tag}: ${e.message}`)

    narrate(
      "debug adapter readability",
      pass,
      pass
        ? `Captured ${renderEvents.length} debug lines for session ${shortId}. Review sample output below.`
        : `No readable debug output captured within ${WAIT_MS / 1000}s.`,
      { sessionID: shortId, sampleOutput: samples }
    )

    expect(pass).toBe(true)
    await client.deleteSession(sessionID).catch(() => undefined)
  })

  test("5. onFileAttachment renders correctly (synthetic)", async () => {
    renderEvents.length = 0

    const file = {
      mime: "application/pdf",
      filename: "quarterly-report.pdf",
      url: "http://example.com/files/report.pdf",
      size: 2_450_000,
    }

    await adapter.onFileAttachment!("ses_synthetic", file)

    const fileEvent = renderEvents.find((e) => e.tag === "FILE" && e.message.includes("quarterly-report"))
    const pass = !!fileEvent

    narrate(
      "onFileAttachment renders file metadata",
      pass,
      pass
        ? `Debug adapter rendered: ${fileEvent!.message}`
        : "No FILE render event found after calling onFileAttachment.",
      { renderedMessage: fileEvent?.message, file }
    )

    expect(pass).toBe(true)
  })

  test("6. onReaction renders correctly (synthetic)", async () => {
    renderEvents.length = 0

    await adapter.onReaction!("ses_synthetic", {
      emoji: "👍",
      userId: "user_yevgeniy",
      messageId: "msg_abc123",
    })

    const reactionEvent = renderEvents.find((e) => e.tag === "REACTION")
    const pass = !!reactionEvent

    narrate(
      "onReaction renders reaction",
      pass,
      pass
        ? `Debug adapter rendered: ${reactionEvent!.message}`
        : "No REACTION render event found after calling onReaction.",
      { renderedMessage: reactionEvent?.message }
    )

    expect(pass).toBe(true)
  })

  test("7. onSessionDeleted renders correctly (synthetic)", async () => {
    renderEvents.length = 0

    await adapter.onSessionDeleted!("ses_deleted_test")

    const deletedEvent = renderEvents.find((e) => e.tag === "SESSION" && e.message.includes("deleted"))
    const pass = !!deletedEvent

    narrate(
      "onSessionDeleted renders deletion",
      pass,
      pass
        ? `Debug adapter rendered: ${deletedEvent!.message}`
        : "No SESSION deletion render event found.",
      { renderedMessage: deletedEvent?.message }
    )

    expect(pass).toBe(true)
  })
})
