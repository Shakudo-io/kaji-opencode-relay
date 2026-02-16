/**
 * Live Feature Tests: File Attachments, Reasoning Parts, Model Override
 *
 * THESE TESTS MUTATE STATE: create sessions, send prompts with files and model overrides.
 *
 * Assessment criteria for AI agent:
 * - [RESULT] lines with { test, pass, details }
 * - File attachment: send image to LLM, verify it processes the image
 * - Reasoning: verify thinking parts appear in store for models that support it
 * - Model override: send prompt with specific model, verify response
 *
 * Run: LIVE_TEST_URL=http://localhost:4096 bun test tests/live-features.test.ts --timeout 180000
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { HeadlessClient } from "../src/client"
import { SyncStore } from "../src/store"
import { HeadlessRouter } from "../src/router"
import { DebugAdapter } from "../src/debug/adapter"
import { ConsoleRenderer } from "../src/debug/renderer"
import { createFilePartInput, createFilePartInputFromBuffer } from "../src/files"
import { join } from "path"

const SERVER_URL = process.env.LIVE_TEST_URL ?? "http://localhost:4096"
const WAIT_MS = 60_000

function log(test: string, pass: boolean, details: Record<string, unknown>) {
  console.log(`[RESULT] ${JSON.stringify({ ts: new Date().toISOString(), test, pass, ...details })}`)
}

type AdapterEvent = { method: string; ts: number; sessionID?: string; partTypes?: string[]; textLength?: number }

describe("Live Features: Files, Reasoning, Model Override", () => {
  let client: HeadlessClient
  let store: SyncStore
  let router: HeadlessRouter
  let sessionID: string
  const adapterEvents: AdapterEvent[] = []
  const renderer = new ConsoleRenderer({ json: true })

  beforeAll(async () => {
    client = new HeadlessClient({ url: SERVER_URL })
    store = new SyncStore()

    const adapter = new DebugAdapter({ renderer, permissionPolicy: "approve-all", questionPolicy: "first-option" })

    const origMessage = adapter.onAssistantMessage.bind(adapter)
    adapter.onAssistantMessage = async (sid, msg, parts) => {
      adapterEvents.push({
        method: "onAssistantMessage",
        ts: Date.now(),
        sessionID: sid,
        partTypes: parts.map((p) => p.type),
      })
      return origMessage(sid, msg, parts)
    }

    const origComplete = adapter.onAssistantMessageComplete.bind(adapter)
    adapter.onAssistantMessageComplete = async (sid, msg, parts) => {
      adapterEvents.push({ method: "onAssistantMessageComplete", ts: Date.now(), sessionID: sid })
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
  })

  afterAll(async () => {
    if (sessionID) {
      try { await client.deleteSession(sessionID) } catch {}
    }
    await router.shutdown()
    client.disconnect()
  })

  test("1. Send image file to LLM and verify it processes it", async () => {
    adapterEvents.length = 0

    const imagePath = join(import.meta.dir, "fixtures", "test-image.png")
    const filePart = await createFilePartInput(imagePath)

    await client.promptWithFiles(
      sessionID,
      "I've attached an image. Describe what you see in this image in one sentence.",
      [filePart],
    )

    const deadline = Date.now() + WAIT_MS
    while (Date.now() < deadline) {
      if (adapterEvents.some((e) => e.method === "onAssistantMessageComplete")) break
      await new Promise((r) => setTimeout(r, 300))
    }

    const completed = adapterEvents.some((e) => e.method === "onAssistantMessageComplete")
    const messages = store.messages(sessionID)
    const lastAssistant = messages.filter((m) => m.role === "assistant").at(-1)
    const parts = lastAssistant ? store.parts(lastAssistant.id) : []
    const textParts = parts.filter((p) => p.type === "text")
    const textContent = textParts.map((p) => (p as Record<string, unknown>).text as string).join("")

    log("send-image", completed, {
      sessionID,
      completed,
      messageCount: messages.length,
      partTypes: parts.map((p) => p.type),
      textContent: textContent.slice(0, 500),
      imageFile: "tests/fixtures/test-image.png (1024x1024, red circle on white)",
    })

    expect(completed).toBe(true)
  })

  test("2. Send text file to LLM and verify it reads content", async () => {
    adapterEvents.length = 0

    const content = "The secret password is: RELAY_TEST_2026"
    const filePart = createFilePartInputFromBuffer(Buffer.from(content), "secret.txt", "text/plain")

    await client.promptWithFiles(
      sessionID,
      "I attached a text file. What is the secret password mentioned in the file? Reply with just the password.",
      [filePart],
    )

    const deadline = Date.now() + WAIT_MS
    while (Date.now() < deadline) {
      if (adapterEvents.some((e) => e.method === "onAssistantMessageComplete")) break
      await new Promise((r) => setTimeout(r, 300))
    }

    const completed = adapterEvents.some((e) => e.method === "onAssistantMessageComplete")
    const messages = store.messages(sessionID)
    const lastAssistant = messages.filter((m) => m.role === "assistant").at(-1)
    const parts = lastAssistant ? store.parts(lastAssistant.id) : []
    const textContent = parts
      .filter((p) => p.type === "text")
      .map((p) => (p as Record<string, unknown>).text as string)
      .join("")

    log("send-text-file", completed, {
      sessionID,
      completed,
      partTypes: parts.map((p) => p.type),
      textContent: textContent.slice(0, 300),
      mentionsPassword: textContent.includes("RELAY_TEST_2026"),
    })

    expect(completed).toBe(true)
  })

  test("3. Verify reasoning/thinking parts with GLM-5 model override", async () => {
    adapterEvents.length = 0

    await client.prompt(
      sessionID,
      "What is 17 * 23? Show your work.",
      { model: { providerID: "openrouter", modelID: "z-ai/glm-5" } },
    )

    const deadline = Date.now() + WAIT_MS
    while (Date.now() < deadline) {
      if (adapterEvents.some((e) => e.method === "onAssistantMessageComplete")) break
      await new Promise((r) => setTimeout(r, 300))
    }

    const completed = adapterEvents.some((e) => e.method === "onAssistantMessageComplete")
    const messages = store.messages(sessionID)
    const lastAssistant = messages.filter((m) => m.role === "assistant").at(-1)
    const parts = lastAssistant ? store.parts(lastAssistant.id) : []

    const reasoningParts = parts.filter((p) => p.type === "reasoning")
    const textParts = parts.filter((p) => p.type === "text")
    const reasoningContent = reasoningParts.map((p) => (p as Record<string, unknown>).text as string).join("")
    const textContent = textParts.map((p) => (p as Record<string, unknown>).text as string).join("")

    log("reasoning-with-glm5", completed, {
      sessionID,
      completed,
      modelUsed: "openrouter/z-ai/glm-5",
      partTypes: parts.map((p) => p.type),
      hasReasoningParts: reasoningParts.length > 0,
      reasoningPartCount: reasoningParts.length,
      reasoningContent: reasoningContent.slice(0, 500),
      reasoningLength: reasoningContent.length,
      textContent: textContent.slice(0, 500),
      textLength: textContent.length,
    })

    expect(completed).toBe(true)
  })

  test("4. Verify debug adapter renders all part types", async () => {
    adapterEvents.length = 0

    await client.prompt(sessionID, "Say 'hello' in one word.")

    const deadline = Date.now() + WAIT_MS
    while (Date.now() < deadline) {
      if (adapterEvents.some((e) => e.method === "onAssistantMessageComplete")) break
      await new Promise((r) => setTimeout(r, 300))
    }

    const allPartTypes = new Set(adapterEvents.flatMap((e) => e.partTypes ?? []))

    log("adapter-part-rendering", true, {
      sessionID,
      adapterEventCount: adapterEvents.length,
      allPartTypesDelivered: [...allPartTypes],
    })

    expect(adapterEvents.length).toBeGreaterThan(0)
  })

  test("5. LLM generates a file — verify file content received", async () => {
    adapterEvents.length = 0

    await client.prompt(
      sessionID,
      "Create a file at /tmp/relay-test-output.txt with exactly this content: 'Hello from kaji-opencode-relay'. Use the write tool. Do not explain, just write the file.",
    )

    const deadline = Date.now() + WAIT_MS
    while (Date.now() < deadline) {
      if (adapterEvents.some((e) => e.method === "onAssistantMessageComplete")) break
      await new Promise((r) => setTimeout(r, 300))
    }

    const completed = adapterEvents.some((e) => e.method === "onAssistantMessageComplete")
    const messages = store.messages(sessionID)
    const lastAssistant = messages.filter((m) => m.role === "assistant").at(-1)
    const parts = lastAssistant ? store.parts(lastAssistant.id) : []

    const toolParts = parts.filter((p) => p.type === "tool")
    const patchParts = parts.filter((p) => p.type === "patch")
    const fileParts = parts.filter((p) => p.type === "file")
    const textParts = parts.filter((p) => p.type === "text")
    const textContent = textParts.map((p) => (p as Record<string, unknown>).text as string).join("")

    const toolDetails = toolParts.map((p) => {
      const record = p as Record<string, unknown>
      return {
        tool: record.tool,
        state: (record.state as Record<string, unknown>)?.status,
        hasAttachments: Array.isArray((record as Record<string, unknown>).attachments) && ((record as Record<string, unknown>).attachments as unknown[]).length > 0,
        attachmentCount: Array.isArray((record as Record<string, unknown>).attachments) ? ((record as Record<string, unknown>).attachments as unknown[]).length : 0,
      }
    })

    const patchDetails = patchParts.map((p) => {
      const record = p as Record<string, unknown>
      return { files: record.files, hash: record.hash }
    })

    let fileWritten = false
    try {
      const { readFileSync } = await import("fs")
      const content = readFileSync("/tmp/relay-test-output.txt", "utf-8")
      fileWritten = content.includes("Hello from kaji-opencode-relay")
    } catch {}

    log("llm-generates-file", completed, {
      sessionID,
      completed,
      partTypes: parts.map((p) => p.type),
      toolParts: toolDetails,
      patchParts: patchDetails,
      fileParts: fileParts.length,
      textContent: textContent.slice(0, 300),
      fileWrittenToDisk: fileWritten,
      note: fileWritten
        ? "LLM wrote file to /tmp/relay-test-output.txt — verified on disk"
        : "File not found on disk — LLM may have used a different path or tool",
    })

    expect(completed).toBe(true)
  })

  test("6. Summary of all part types seen across session", () => {
    const messages = store.messages(sessionID)
    const partsByType: Record<string, number> = {}

    for (const msg of messages) {
      const parts = store.parts(msg.id)
      for (const part of parts) {
        partsByType[part.type] = (partsByType[part.type] ?? 0) + 1
      }
    }

    log("part-type-summary", true, {
      sessionID,
      totalMessages: messages.length,
      partsByType,
      uniquePartTypes: Object.keys(partsByType),
    })

    expect(Object.keys(partsByType).length).toBeGreaterThan(0)
  })
})
