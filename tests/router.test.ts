import { beforeEach, describe, expect, test } from "bun:test"
import { HeadlessClient, type SdkClient } from "../src/client"
import type { ChannelAdapter } from "../src/adapter"
import { HeadlessRouter } from "../src/router"
import { SyncStore } from "../src/store"
import type { PermissionRequest, QuestionRequest } from "../src/types"

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
})
