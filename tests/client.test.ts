import { beforeEach, describe, expect, test } from "bun:test"
import { HeadlessClient, type SdkClient, type SdkFactoryConfig } from "../src/client"

type SSEEvent = { type: string; properties: Record<string, unknown> }

type SubscribeResult = { stream: AsyncIterable<SSEEvent> }
type SubscribeFn = (input: Record<string, never>, options?: { signal?: AbortSignal }) => Promise<SubscribeResult>

const streams: AsyncIterable<SSEEvent>[] = []
let subscribeCalls = 0
let createClientConfig: SdkFactoryConfig | undefined

const makeStream = (events: SSEEvent[]): AsyncIterable<SSEEvent> =>
  (async function* () {
    for (const event of events) {
      yield event
    }
  })()

const waitFor = async (condition: () => boolean, timeoutMs = 200): Promise<void> => {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition")
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const createSdk = () => {
  const subscribe: SubscribeFn = async () => {
    subscribeCalls += 1
    const next = streams.shift() ?? makeStream([])
    return { stream: next }
  }

  return {
    event: { subscribe },
    client: {
      session: {
        create: async () => ({ id: "session" }),
        prompt: async () => ({ id: "message", role: "assistant", sessionID: "session", time: {} }),
        abort: async () => ({ id: "session" }),
        fork: async () => ({ id: "session" }),
        summarize: async () => ({ id: "session" }),
        revert: async () => ({ id: "session" }),
        unrevert: async () => ({ id: "session" }),
        share: async () => ({ id: "session" }),
        unshare: async () => ({ id: "session" }),
        delete: async () => ({ id: "session" }),
      },
      permission: {
        reply: async () => ({ id: "permission", sessionID: "session" }),
      },
      question: {
        reply: async () => ({ id: "question", sessionID: "session" }),
        reject: async () => ({ id: "question", sessionID: "session" }),
      },
    },
  } as SdkClient
}

beforeEach(() => {
  streams.length = 0
  subscribeCalls = 0
  createClientConfig = undefined
})

describe("HeadlessClient", () => {
  test("connects and emits SSE events", async () => {
    const eventOne: SSEEvent = { type: "session.updated", properties: {} }
    const eventTwo: SSEEvent = { type: "session.deleted", properties: {} }
    streams.push(makeStream([eventOne, eventTwo]))

    const client = new HeadlessClient({
      url: "http://localhost",
      createClient: (config) => {
        createClientConfig = config
        return createSdk()
      },
    })

    const received: string[] = []

    client.on("event", (event) => {
      received.push(event.type)
    })

    await client.connect()
    await waitFor(() => received.length === 2)

    expect(received).toEqual(["session.updated", "session.deleted"])
    expect(createClientConfig?.baseUrl).toBe("http://localhost")
    client.disconnect()
  })

  test("uses custom event source and skips SSE", async () => {
    const eventSourceListeners: Array<(event: SSEEvent) => void> = []
    const eventSource = {
      on: (handler: (event: SSEEvent) => void) => {
        eventSourceListeners.push(handler)
        return () => {
          const index = eventSourceListeners.indexOf(handler)
          if (index >= 0) eventSourceListeners.splice(index, 1)
        }
      },
    }

    const client = new HeadlessClient({
      url: "http://localhost",
      events: eventSource,
      createClient: () => createSdk(),
    })

    const received: string[] = []
    client.on("event", (event) => received.push(event.type))

    await client.connect()
    const event: SSEEvent = { type: "permission.asked", properties: {} }
    eventSourceListeners[0]?.(event)

    await waitFor(() => received.length === 1)
    expect(received).toEqual(["permission.asked"])
    expect(subscribeCalls).toBe(0)
    client.disconnect()
  })

  test("disconnect unsubscribes from custom event source", async () => {
    let unsubscribed = false
    const eventSource = {
      on: () => () => {
        unsubscribed = true
      },
    }

    const client = new HeadlessClient({
      url: "http://localhost",
      events: eventSource,
      createClient: () => createSdk(),
    })

    await client.connect()
    client.disconnect()

    expect(unsubscribed).toBe(true)
  })

  test("batches events within the interval", async () => {
    const eventSourceListeners: Array<(event: SSEEvent) => void> = []
    const eventSource = {
      on: (handler: (event: SSEEvent) => void) => {
        eventSourceListeners.push(handler)
        return () => undefined
      },
    }

    const client = new HeadlessClient({
      url: "http://localhost",
      events: eventSource,
      batchInterval: 50,
      createClient: () => createSdk(),
    })

    const received: string[] = []
    client.on("event", (event) => received.push(event.type))

    await client.connect()
    eventSourceListeners[0]?.({ type: "session.updated", properties: {} })
    eventSourceListeners[0]?.({ type: "session.status", properties: {} })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(received).toEqual(["session.updated"])

    await waitFor(() => received.length === 2, 200)
    expect(received).toEqual(["session.updated", "session.status"])
    client.disconnect()
  })

  test("reconnects when SSE stream ends", async () => {
    const first = makeStream([{ type: "session.updated", properties: {} }])
    const second = makeStream([{ type: "session.deleted", properties: {} }])
    streams.push(first, second)

    const client = new HeadlessClient({
      url: "http://localhost",
      createClient: (config) => {
        createClientConfig = config
        return createSdk()
      },
    })

    const reconnects: number[] = []
    const reconnected: number[] = []
    const received: string[] = []

    client.on("reconnecting", ({ attempt }) => reconnects.push(attempt))
    client.on("reconnected", ({ attempt }) => reconnected.push(attempt))
    client.on("event", (event) => received.push(event.type))

    await client.connect()
    await waitFor(() => received.length === 2, 300)

    expect(received).toEqual(["session.updated", "session.deleted"])
    expect(reconnects.length).toBeGreaterThan(0)
    expect(reconnected.length).toBeGreaterThan(0)
    client.disconnect()
  })
})
