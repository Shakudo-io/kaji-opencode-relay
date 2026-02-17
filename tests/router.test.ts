import { beforeEach, describe, expect, test } from "bun:test"
import { HeadlessClient, type SdkClient } from "../src/client"
import type { ChannelAdapter } from "../src/adapter"
import { HeadlessRouter } from "../src/router"
import { SyncStore } from "../src/store"
import type { Message, PermissionRequest, QuestionRequest } from "../src/types"

type PermissionReplyInput = { sessionID: string; requestID: string; reply: "once" | "always" | "reject"; message?: string }
type QuestionReplyInput = { sessionID: string; requestID: string; answers: string[][] }
type QuestionRejectInput = { sessionID: string; requestID: string }

const makePermissionRequest = (id: string): PermissionRequest => ({
  id,
  sessionID: "session",
  permission: "write",
  patterns: [],
  metadata: {},
  always: [],
})

const makeQuestionRequest = (id: string): QuestionRequest => ({
  id,
  sessionID: "session",
  questions: [
    {
      question: "Continue?",
      header: "Confirm",
      options: [{ label: "Yes", description: "Proceed" }],
      multiple: false,
    },
  ],
})

const makeUserMessage = (id: string, text: string): Message => ({
  id,
  sessionID: "session",
  role: "user",
  time: { created: Date.now() },
  agent: "user",
  model: { providerID: "provider", modelID: "model" },
  summary: { title: text, body: text, diffs: [] },
})

const makeAdapter = (id: string, channel: string, onInboundMessage?: ChannelAdapter["onInboundMessage"]): ChannelAdapter => {
  const adapter: ChannelAdapter = {
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
  }
  if (onInboundMessage) {
    adapter.onInboundMessage = onInboundMessage
  }
  return adapter
}

const waitFor = async (condition: () => boolean, timeoutMs = 200): Promise<void> => {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition")
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe("HeadlessRouter", () => {
  let permissionReplies: PermissionReplyInput[]
  let questionReplies: QuestionReplyInput[]
  let questionRejects: QuestionRejectInput[]

  beforeEach(() => {
    permissionReplies = []
    questionReplies = []
    questionRejects = []
  })

  const createClient = () => {
    const sdk = {
      event: {
        subscribe: async () => ({
          stream: (async function* () {})(),
        }),
      },
      permission: {
        reply: async (input: { requestID: string; reply?: string; message?: string }) => {
          permissionReplies.push({ sessionID: "session", requestID: input.requestID, reply: (input.reply ?? "reject") as "once" | "always" | "reject", message: input.message })
          return { data: { id: input.requestID } }
        },
      },
      question: {
        reply: async (input: { requestID: string; answers?: string[][] }) => {
          questionReplies.push({ sessionID: "session", requestID: input.requestID, answers: input.answers ?? [] })
          return { data: { id: input.requestID } }
        },
        reject: async (input: { requestID: string }) => {
          questionRejects.push({ sessionID: "session", requestID: input.requestID })
          return { data: { id: input.requestID } }
        },
      },
      session: {
        create: async () => ({ data: { id: "session" } }),
        prompt: async () => ({ data: { id: "message" } }),
      },
    } as SdkClient

    return new HeadlessClient({
      url: "http://localhost",
      events: { on: () => () => undefined },
      createClient: () => sdk,
    })
  }

  test("routes permission requests to adapter", async () => {
    const client = createClient()
    await client.connect()
    const store = new SyncStore()
    const adapter: ChannelAdapter = {
      id: "adapter",
      channel: "test",
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
    }

    const router = new HeadlessRouter({ client, store, adapters: [adapter] })
    store.processEvent({ type: "permission.asked", properties: makePermissionRequest("perm-1") })

    await waitFor(() => permissionReplies.length === 1)
    expect(permissionReplies[0]?.reply).toBe("once")

    await router.shutdown()
    await client.disconnect()
  })

  test("auto-rejects question when adapter throws", async () => {
    const client = createClient()
    await client.connect()
    const store = new SyncStore()
    const adapter: ChannelAdapter = {
      id: "adapter",
      channel: "test",
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
      onQuestionRequest: async () => {
        throw new Error("adapter failed")
      },
      onSessionStatus: () => undefined,
      onTodoUpdate: () => undefined,
      onSessionError: () => undefined,
      onToast: () => undefined,
    }

    const router = new HeadlessRouter({ client, store, adapters: [adapter] })
    store.processEvent({ type: "question.asked", properties: makeQuestionRequest("question-1") })

    await waitFor(() => questionRejects.length === 1)
    expect(questionRejects[0]?.requestID).toBe("question-1")

    await router.shutdown()
    await client.disconnect()
  })

  test("suppresses inbound echo for adapter-originated prompt", async () => {
    const client = createClient()
    await client.connect()
    const store = new SyncStore()

    const inboundEvents: Array<{ sessionID: string }> = []
    const adapter = makeAdapter("adapter", "console", async (sessionID) => {
      inboundEvents.push({ sessionID })
    })

    const router = new HeadlessRouter({ client, store, adapters: [adapter] })
    await router.promptWithOrigin("session", "hello", "adapter")
    store.processEvent({ type: "message.updated", properties: { info: makeUserMessage("msg-1", "hello") } })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(inboundEvents.length).toBe(0)

    await router.shutdown()
    await client.disconnect()
  })

  test("routes inbound message with external origin", async () => {
    const client = createClient()
    await client.connect()
    const store = new SyncStore()

    const inboundEvents: Array<{ sessionID: string; text: string; originId: string; originChannel: string }> = []
    const originAdapter = makeAdapter("origin", "origin-channel")
    const receiverAdapter = makeAdapter("receiver", "receiver-channel", async (sessionID, text, origin) => {
      inboundEvents.push({ sessionID, text, originId: origin.adapterId, originChannel: origin.channel })
    })

    const router = new HeadlessRouter({ client, store, adapters: [originAdapter, receiverAdapter] })
    router.setSessionAdapter("session", "receiver")

    await router.promptWithOrigin("session", "hello", "origin")
    store.processEvent({ type: "message.updated", properties: { info: makeUserMessage("msg-2", "hello") } })

    await waitFor(() => inboundEvents.length === 1)
    expect(inboundEvents[0]).toEqual({ sessionID: "session", text: "hello", originId: "origin", originChannel: "origin-channel" })

    await router.shutdown()
    await client.disconnect()
  })

  test("uses tui origin when no prompt is queued", async () => {
    const client = createClient()
    await client.connect()
    const store = new SyncStore()

    const inboundEvents: Array<{ originId: string; originChannel: string }> = []
    const adapter = makeAdapter("adapter", "console", async (_sessionID, _text, origin) => {
      inboundEvents.push({ originId: origin.adapterId, originChannel: origin.channel })
    })

    const router = new HeadlessRouter({ client, store, adapters: [adapter] })
    store.processEvent({ type: "message.updated", properties: { info: makeUserMessage("msg-3", "from tui") } })

    await waitFor(() => inboundEvents.length === 1)
    expect(inboundEvents[0]).toEqual({ originId: "tui", originChannel: "terminal" })

    await router.shutdown()
    await client.disconnect()
  })

  test("catches adapter callback errors without crashing router", async () => {
    const client = createClient()
    await client.connect()
    const store = new SyncStore()

    const throwingAdapter = makeAdapter("thrower", "throw-channel", async () => {
      throw new Error("adapter exploded")
    })
    const healthy: string[] = []
    const healthyAdapter = makeAdapter("healthy", "healthy-channel", async (_sid, text) => {
      healthy.push(text)
    })

    const router = new HeadlessRouter({ client, store, adapters: [throwingAdapter, healthyAdapter] })
    router.setSessionAdapter("session", "healthy")

    store.processEvent({ type: "message.updated", properties: { info: makeUserMessage("msg-err", "hello") } })

    await waitFor(() => healthy.length === 1)
    expect(healthy[0]).toBe("hello")

    await router.shutdown()
    await client.disconnect()
  })

  test("tracks prompt origins in FIFO order", async () => {
    const client = createClient()
    await client.connect()
    const store = new SyncStore()

    const origins: string[] = []
    const adapterA = makeAdapter("origin-a", "channel-a")
    const adapterB = makeAdapter("origin-b", "channel-b")
    const receiver = makeAdapter("receiver", "receiver-channel", async (_sessionID, _text, origin) => {
      origins.push(origin.adapterId)
    })

    const router = new HeadlessRouter({ client, store, adapters: [adapterA, adapterB, receiver] })
    router.setSessionAdapter("session", "receiver")

    await router.promptWithOrigin("session", "first", "origin-a")
    await router.promptWithOrigin("session", "second", "origin-b")

    store.processEvent({ type: "message.updated", properties: { info: makeUserMessage("msg-4", "first") } })
    store.processEvent({ type: "message.updated", properties: { info: makeUserMessage("msg-5", "second") } })

    await waitFor(() => origins.length === 2)
    expect(origins).toEqual(["origin-a", "origin-b"])

    await router.shutdown()
    await client.disconnect()
  })
})
