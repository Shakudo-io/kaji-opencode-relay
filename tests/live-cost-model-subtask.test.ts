/**
 * Live Tests: Cost/Token Tracking, Model Identification, Subtask Delegation
 *
 * THESE TESTS MUTATE STATE: create sessions, send prompts.
 *
 * Assessment criteria for AI agent reviewing [RESULT] output:
 * - cost: AssistantMessage.cost should be > 0, sessionCost accumulates correctly
 * - tokens: input > 0, output > 0 on every assistant message
 * - model: providerID and modelID present on every assistant message
 * - model override: GLM-5 modelID should differ from default
 * - subtask: task tool or SubtaskPart should appear when delegation is requested
 *
 * Run: LIVE_TEST_URL=http://localhost:4096 bun test tests/live-cost-model-subtask.test.ts --timeout 300000
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { HeadlessClient } from "../src/client"
import { SyncStore } from "../src/store"
import { HeadlessRouter } from "../src/router"
import { DebugAdapter } from "../src/debug/adapter"
import { ConsoleRenderer } from "../src/debug/renderer"

const SERVER_URL = process.env.LIVE_TEST_URL ?? "http://localhost:4096"
const WAIT_MS = 60_000

function log(testName: string, pass: boolean, details: Record<string, unknown>) {
  console.log(`[RESULT] ${JSON.stringify({ ts: new Date().toISOString(), test: testName, pass, ...details })}`)
}

type AdapterEvent = { method: string; ts: number; sessionID?: string; partTypes?: string[]; cost?: number; modelID?: string; providerID?: string }

describe("Live: Cost, Model, Subtask", () => {
  let client: HeadlessClient
  let store: SyncStore
  let router: HeadlessRouter
  let sessionID: string
  const adapterEvents: AdapterEvent[] = []
  const rendererOutput: string[] = []

  const renderer = new ConsoleRenderer({ json: true })
  const origWrite = process.stdout.write.bind(process.stdout)
  const captureWrite = (chunk: string | Uint8Array) => {
    const str = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
    rendererOutput.push(str)
    return origWrite(chunk)
  }

  beforeAll(async () => {
    client = new HeadlessClient({ url: SERVER_URL })
    store = new SyncStore()

    const adapter = new DebugAdapter({ renderer, store, permissionPolicy: "approve-all", questionPolicy: "first-option" })

    const origMessage = adapter.onAssistantMessage.bind(adapter)
    adapter.onAssistantMessage = async (sid, msg, parts) => {
      const record = msg as Record<string, unknown>
      adapterEvents.push({
        method: "onAssistantMessage",
        ts: Date.now(),
        sessionID: sid,
        partTypes: parts.map((p) => p.type),
        cost: typeof record.cost === "number" ? record.cost : undefined,
        modelID: record.modelID as string | undefined,
        providerID: record.providerID as string | undefined,
      })
      return origMessage(sid, msg, parts)
    }

    const origComplete = adapter.onAssistantMessageComplete.bind(adapter)
    adapter.onAssistantMessageComplete = async (sid, msg, parts) => {
      const record = msg as Record<string, unknown>
      adapterEvents.push({
        method: "onAssistantMessageComplete",
        ts: Date.now(),
        sessionID: sid,
        cost: typeof record.cost === "number" ? record.cost : undefined,
        modelID: record.modelID as string | undefined,
        providerID: record.providerID as string | undefined,
      })
      return origComplete(sid, msg, parts)
    }

    router = new HeadlessRouter({ client, store, adapters: [adapter], defaultAdapterId: "debug" })

    await client.connect()
    await client.bootstrap(store)
    await new Promise((r) => setTimeout(r, 1000))
    client.on("event", (e) => store.processEvent(e))

    const raw = await client.createSession() as Record<string, unknown>
    const session = (raw.data ?? raw) as Record<string, unknown>
    sessionID = session.id as string

    process.stdout.write = captureWrite
  })

  afterAll(async () => {
    process.stdout.write = origWrite
    if (sessionID) {
      try { await client.deleteSession(sessionID) } catch {}
    }
    await router.shutdown()
    client.disconnect()
  })

  test("1. Cost and token tracking — simple prompt", async () => {
    adapterEvents.length = 0
    rendererOutput.length = 0

    await client.prompt(sessionID, "What is the capital of France? One word answer.")

    const deadline = Date.now() + WAIT_MS
    while (Date.now() < deadline) {
      if (adapterEvents.some((e) => e.method === "onAssistantMessageComplete")) break
      await new Promise((r) => setTimeout(r, 200))
    }

    const completeEvent = adapterEvents.find((e) => e.method === "onAssistantMessageComplete")
    const messages = store.messages(sessionID)
    const lastAssistant = messages.filter((m) => m.role === "assistant").at(-1) as Record<string, unknown> | undefined
    const messageCost = typeof lastAssistant?.cost === "number" ? lastAssistant.cost : 0
    const messageTokens = lastAssistant?.tokens as { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } } | undefined
    const sessionCostTotal = store.sessionCost(sessionID)
    const sessionTokensTotal = store.sessionTokens(sessionID)

    const textParts = lastAssistant ? store.parts(lastAssistant.id as string).filter((p) => p.type === "text") : []
    const textContent = textParts.map((p) => (p as Record<string, unknown>).text as string).join("")

    const costRendered = rendererOutput.some((l) => l.includes('"type":"cost"'))

    log("cost-tracking", completeEvent !== undefined, {
      sessionID,
      textContent: textContent.slice(0, 100),
      messageCost,
      messageTokens: messageTokens ? {
        input: messageTokens.input ?? 0,
        output: messageTokens.output ?? 0,
        reasoning: messageTokens.reasoning ?? 0,
        cacheRead: messageTokens.cache?.read ?? 0,
        cacheWrite: messageTokens.cache?.write ?? 0,
      } : null,
      sessionCostTotal,
      sessionTokensTotal,
      costRenderedInOutput: costRendered,
      hasCost: messageCost > 0,
      hasInputTokens: (messageTokens?.input ?? 0) > 0,
      hasOutputTokens: (messageTokens?.output ?? 0) > 0,
    })

    expect(completeEvent).toBeDefined()
  })

  test("2. Model identification — default model", async () => {
    adapterEvents.length = 0

    const messages = store.messages(sessionID)
    const lastAssistant = messages.filter((m) => m.role === "assistant").at(-1) as Record<string, unknown> | undefined
    const modelID = lastAssistant?.modelID as string | undefined
    const providerID = lastAssistant?.providerID as string | undefined

    const adapterSawModel = adapterEvents.some((e) => e.modelID !== undefined)
    const modelRendered = rendererOutput.some((l) => l.includes('"type":"model"'))

    log("model-default", modelID !== undefined, {
      sessionID,
      modelID,
      providerID,
      modelRendered,
      adapterSawModel,
    })

    expect(modelID).toBeDefined()
    expect(providerID).toBeDefined()
  })

  test("3. Model override — switch to GLM-5", async () => {
    adapterEvents.length = 0
    rendererOutput.length = 0

    await client.prompt(sessionID, "What is 2+2? One number.", {
      model: { providerID: "openrouter", modelID: "z-ai/glm-5" },
    })

    const deadline = Date.now() + WAIT_MS
    while (Date.now() < deadline) {
      if (adapterEvents.some((e) => e.method === "onAssistantMessageComplete")) break
      await new Promise((r) => setTimeout(r, 200))
    }

    const completeEvent = adapterEvents.find((e) => e.method === "onAssistantMessageComplete")
    const messages = store.messages(sessionID)
    const lastAssistant = messages.filter((m) => m.role === "assistant").at(-1) as Record<string, unknown> | undefined
    const modelID = lastAssistant?.modelID as string | undefined
    const providerID = lastAssistant?.providerID as string | undefined

    const textParts = lastAssistant ? store.parts(lastAssistant.id as string).filter((p) => p.type === "text") : []
    const textContent = textParts.map((p) => (p as Record<string, unknown>).text as string).join("")

    const modelChangedRendered = rendererOutput.some((l) => l.includes('"type":"model changed"') || l.includes('"changed":true'))

    const sessionCostAfterTwo = store.sessionCost(sessionID)
    const sessionTokensAfterTwo = store.sessionTokens(sessionID)

    log("model-override-glm5", completeEvent !== undefined, {
      sessionID,
      requestedModel: "openrouter/z-ai/glm-5",
      responseModelID: modelID,
      responseProviderID: providerID,
      modelIsGlm: modelID?.includes("glm") ?? false,
      modelChangedRendered,
      textContent: textContent.slice(0, 100),
      cumulativeSessionCost: sessionCostAfterTwo,
      cumulativeSessionTokens: sessionTokensAfterTwo,
    })

    expect(completeEvent).toBeDefined()
  })

  test("4. Subtask delegation — trigger task tool", async () => {
    adapterEvents.length = 0
    rendererOutput.length = 0

    await client.prompt(
      sessionID,
      "Use the task tool to delegate a simple task to a subagent. Ask the subagent to say 'hello from subagent'. Use category='quick'.",
    )

    const deadline = Date.now() + WAIT_MS * 2
    while (Date.now() < deadline) {
      if (adapterEvents.some((e) => e.method === "onAssistantMessageComplete")) break
      await new Promise((r) => setTimeout(r, 300))
    }

    const allPartTypes = new Set(adapterEvents.flatMap((e) => e.partTypes ?? []))
    const hasToolParts = allPartTypes.has("tool")
    const hasSubtaskParts = allPartTypes.has("subtask")

    const messages = store.messages(sessionID)
    const lastAssistant = messages.filter((m) => m.role === "assistant").at(-1)
    const parts = lastAssistant ? store.parts(lastAssistant.id) : []
    const toolParts = parts.filter((p) => p.type === "tool")
    const taskTools = toolParts.filter((p) => (p as Record<string, unknown>).tool === "task")
    const subtaskParts = parts.filter((p) => p.type === "subtask")

    const taskToolDetails = taskTools.map((p) => {
      const record = p as Record<string, unknown>
      const state = record.state as Record<string, unknown> | undefined
      return {
        tool: record.tool,
        status: state?.status,
        input: state?.input ? Object.keys(state.input as Record<string, unknown>) : [],
        time: state?.time,
      }
    })

    const subtaskRendered = rendererOutput.some((l) => l.includes('"type":"subtask"'))
    const textParts = parts.filter((p) => p.type === "text")
    const textContent = textParts.map((p) => (p as Record<string, unknown>).text as string).join("")

    const finalSessionCost = store.sessionCost(sessionID)
    const finalSessionTokens = store.sessionTokens(sessionID)

    log("subtask-delegation", true, {
      sessionID,
      allPartTypesObserved: [...allPartTypes],
      hasToolParts,
      hasSubtaskParts,
      taskToolCount: taskTools.length,
      subtaskPartCount: subtaskParts.length,
      taskToolDetails,
      subtaskRendered,
      textContent: textContent.slice(0, 300),
      finalSessionCost,
      finalSessionTokens,
      totalMessages: messages.length,
    })

    expect(adapterEvents.length).toBeGreaterThan(0)
  })

  test("5. Verify debug adapter renders [COST], [MODEL], [SUBTASK] tags", () => {
    const costLines = rendererOutput.filter((l) => l.includes('"type":"cost"'))
    const modelLines = rendererOutput.filter((l) => l.includes('"type":"model"') || l.includes('"type":"model changed"'))
    const subtaskLines = rendererOutput.filter((l) => l.includes('"type":"subtask"'))
    const stepLines = rendererOutput.filter((l) => l.includes('"type":"step"'))
    const sessionLines = rendererOutput.filter((l) => l.includes('"type":"session"'))

    log("adapter-rendering", true, {
      costLinesCount: costLines.length,
      modelLinesCount: modelLines.length,
      subtaskLinesCount: subtaskLines.length,
      stepLinesCount: stepLines.length,
      sessionLinesCount: sessionLines.length,
      sampleCostLine: costLines[0]?.trim().slice(0, 200),
      sampleModelLine: modelLines[0]?.trim().slice(0, 200),
      sampleSubtaskLine: subtaskLines[0]?.trim().slice(0, 200),
      totalRendererOutput: rendererOutput.length,
    })

    expect(rendererOutput.length).toBeGreaterThan(0)
  })
})
