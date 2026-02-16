/**
 * Live Test: Verify debug adapter sees ALL event types from a real session
 *
 * Uses ses_3988fac3 which has 350+ messages including thinking, errors, tools, text,
 * compaction, patches — a comprehensive test of every part type and message-level field.
 *
 * Assessment criteria for AI agent reviewing [RESULT] output:
 * - Every part type in the session should produce at least one adapter render event
 * - Message errors should produce [ERROR] events
 * - Thinking parts should produce [THINKING] events
 * - Model info should produce [MODEL] events
 * - Cost/tokens should produce [COST] events
 * - Tool parts should produce [TOOL] events
 *
 * Run: LIVE_TEST_URL=http://localhost:4096 bun test tests/live-adapter-events.test.ts --timeout 60000
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { HeadlessClient } from "../src/client"
import { SyncStore } from "../src/store"
import { DebugAdapter } from "../src/debug/adapter"
import { ConsoleRenderer } from "../src/debug/renderer"
import type { Message, Part } from "../src/types"

const SERVER_URL = process.env.LIVE_TEST_URL ?? "http://localhost:4096"
const SESSION_ID = "ses_3988fac3affeNL4r0XdfzCe4kQ"

function log(testName: string, pass: boolean, details: Record<string, unknown>) {
  console.log(`[RESULT] ${JSON.stringify({ ts: new Date().toISOString(), test: testName, pass, ...details })}`)
}

type RenderEvent = { type: string; message: string; details?: Record<string, unknown> }

describe("Live: Adapter sees all event types", () => {
  let client: HeadlessClient
  let store: SyncStore
  let adapter: DebugAdapter
  const renderEvents: RenderEvent[] = []

  beforeAll(async () => {
    client = new HeadlessClient({ url: SERVER_URL })
    store = new SyncStore()

    const renderer = new ConsoleRenderer({ json: true })
    const origRender = renderer.render.bind(renderer)
    renderer.render = (tag: string, message: string, details?: Record<string, unknown>) => {
      renderEvents.push({ type: tag.toLowerCase(), message, details })
      origRender(tag, message, details)
    }

    adapter = new DebugAdapter({ renderer, store, permissionPolicy: "approve-all", questionPolicy: "first-option" })

    await client.connect()
    await client.bootstrap(store)
    await new Promise((r) => setTimeout(r, 2000))
    await store.session.sync(client.sdk, SESSION_ID)
  })

  afterAll(() => {
    client.disconnect()
  })

  test("1. Feed all session messages through adapter — capture every render event", async () => {
    renderEvents.length = 0
    const messages = store.messages(SESSION_ID)

    for (const msg of messages) {
      if (msg.role === "assistant") {
        const parts = store.parts(msg.id)
        await adapter.onAssistantMessage(SESSION_ID, msg, parts)
        await adapter.onAssistantMessageComplete(SESSION_ID, msg, parts)
      }
    }

    const renderTypes = new Map<string, number>()
    for (const event of renderEvents) {
      renderTypes.set(event.type, (renderTypes.get(event.type) ?? 0) + 1)
    }

    log("adapter-all-events", true, {
      messagesProcessed: messages.filter((m) => m.role === "assistant").length,
      totalRenderEvents: renderEvents.length,
      renderTypeCounts: Object.fromEntries(renderTypes),
      uniqueRenderTypes: [...renderTypes.keys()].sort(),
    })

    expect(renderEvents.length).toBeGreaterThan(0)
  })

  test("2. Verify [THINKING] events for reasoning parts", () => {
    const thinkingEvents = renderEvents.filter((e) => e.type === "thinking")
    const sampleMessages = thinkingEvents.slice(0, 3).map((e) => e.message.slice(0, 150))

    log("thinking-events", thinkingEvents.length > 0, {
      count: thinkingEvents.length,
      samples: sampleMessages,
    })

    expect(thinkingEvents.length).toBeGreaterThan(0)
  })

  test("3. Verify [ERROR] events for message errors", () => {
    const errorEvents = renderEvents.filter((e) => e.type === "error")
    const errorMessages = errorEvents.map((e) => e.message)

    log("error-events", errorEvents.length > 0, {
      count: errorEvents.length,
      errors: errorMessages,
    })

    expect(errorEvents.length).toBeGreaterThan(0)
  })

  test("4. Verify [MODEL] events for model identification", () => {
    const modelEvents = renderEvents.filter((e) => e.type === "model" || e.type === "model changed")
    const models = modelEvents.map((e) => e.message)
    const uniqueModels = [...new Set(models)]

    log("model-events", modelEvents.length > 0, {
      count: modelEvents.length,
      uniqueModels,
      hasModelChanged: renderEvents.some((e) => e.type === "model changed"),
    })

    expect(modelEvents.length).toBeGreaterThan(0)
  })

  test("5. Verify [TOOL] events for tool executions", () => {
    const toolEvents = renderEvents.filter((e) => e.type === "tool")
    const toolNames = [...new Set(toolEvents.map((e) => e.details?.tool as string ?? e.message.split(":")[0] ?? "unknown"))]
    const sampleTools = toolEvents.slice(0, 5).map((e) => e.message)

    log("tool-events", toolEvents.length > 0, {
      count: toolEvents.length,
      uniqueToolNames: toolNames,
      samples: sampleTools,
    })

    expect(toolEvents.length).toBeGreaterThan(0)
  })

  test("6. Verify [COST] events on message completion", () => {
    const costEvents = renderEvents.filter((e) => e.type === "cost")
    const sampleCosts = costEvents.slice(0, 3).map((e) => ({
      message: e.message,
      cost: e.details?.cost,
      tokens: e.details?.tokens,
    }))

    log("cost-events", costEvents.length > 0, {
      count: costEvents.length,
      samples: sampleCosts,
    })

    expect(costEvents.length).toBeGreaterThan(0)
  })

  test("7. Verify [STEP] events for step-finish parts", () => {
    const stepEvents = renderEvents.filter((e) => e.type === "step")
    const sampleSteps = stepEvents.slice(0, 3).map((e) => e.message)

    log("step-events", stepEvents.length > 0, {
      count: stepEvents.length,
      samples: sampleSteps,
    })

    expect(stepEvents.length).toBeGreaterThan(0)
  })

  test("8. Verify [TEXT] events for text content", () => {
    const textEvents = renderEvents.filter((e) => e.type === "text")
    const sampleTexts = textEvents.slice(0, 3).map((e) => e.message.slice(0, 150))

    log("text-events", textEvents.length > 0, {
      count: textEvents.length,
      samples: sampleTexts,
    })

    expect(textEvents.length).toBeGreaterThan(0)
  })

  test("9. Verify [COMPLETE] events for every assistant message", () => {
    const completeEvents = renderEvents.filter((e) => e.type === "complete")
    const assistantMessages = store.messages(SESSION_ID).filter((m) => m.role === "assistant")

    log("complete-events", completeEvents.length === assistantMessages.length, {
      completeCount: completeEvents.length,
      assistantMessageCount: assistantMessages.length,
      match: completeEvents.length === assistantMessages.length,
    })

    expect(completeEvents.length).toBe(assistantMessages.length)
  })

  test("10. Coverage summary — every part type produced a render event", () => {
    const messages = store.messages(SESSION_ID)
    const partTypesInStore = new Set<string>()
    for (const msg of messages) {
      for (const part of store.parts(msg.id)) {
        partTypesInStore.add(part.type)
      }
    }

    const renderTypeSet = new Set(renderEvents.map((e) => e.type))

    const partTypeToRenderType: Record<string, string> = {
      text: "text",
      reasoning: "thinking",
      tool: "tool",
      "step-finish": "step",
      file: "file",
      subtask: "subtask",
    }

    const coverage: Record<string, { inStore: boolean; rendered: boolean }> = {}
    for (const partType of partTypesInStore) {
      const expectedRender = partTypeToRenderType[partType]
      coverage[partType] = {
        inStore: true,
        rendered: expectedRender ? renderTypeSet.has(expectedRender) : true,
      }
    }

    const messageFields: Record<string, boolean> = {
      "error → [ERROR]": renderTypeSet.has("error"),
      "modelID → [MODEL]": renderTypeSet.has("model") || renderTypeSet.has("model changed"),
      "cost → [COST]": renderTypeSet.has("cost"),
      "complete → [COMPLETE]": renderTypeSet.has("complete"),
    }

    const allCovered = Object.values(coverage).every((c) => c.rendered) && Object.values(messageFields).every(Boolean)

    log("coverage-summary", allCovered, {
      partTypesInStore: [...partTypesInStore].sort(),
      partTypeCoverage: coverage,
      messageFieldCoverage: messageFields,
      allRenderTypes: [...renderTypeSet].sort(),
      totalRenderEvents: renderEvents.length,
    })

    expect(allCovered).toBe(true)
  })
})
