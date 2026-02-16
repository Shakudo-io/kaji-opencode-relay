import { describe, expect, test } from "bun:test"
import { SyncStore } from "../src/store"
import type { Event, Message, Part, PermissionRequest, Session } from "../src/types"

const makeSession = (id: string): Session => ({
  id,
  slug: id,
  projectID: "project",
  directory: "/tmp/project",
  title: "Session",
  version: "1",
  time: { created: Date.now(), updated: Date.now() },
})

const makePermissionRequest = (id: string): PermissionRequest => ({
  id,
  sessionID: "session",
  permission: "write",
  patterns: [],
  metadata: {},
  always: [],
})

const makeAssistantMessage = (id: string, completed = false): Message => ({
  id,
  sessionID: "session",
  role: "assistant",
  time: { created: Date.now(), completed: completed ? Date.now() : undefined },
  parentID: "parent",
  modelID: "model",
  providerID: "provider",
  mode: "build",
  agent: "build",
  path: { cwd: "/tmp/project", root: "/tmp" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
})

const makeTextPart = (id: string, messageID: string): Part => ({
  id,
  sessionID: "session",
  messageID,
  type: "text",
  text: "hello",
})

describe("SyncStore", () => {
  test("tracks permission requests and replies", () => {
    const store = new SyncStore()
    const permissionEvents: PermissionRequest[] = []
    store.on("permission", ({ request }) => permissionEvents.push(request))

    const request = makePermissionRequest("perm-1")
    const asked: Event = { type: "permission.asked", properties: request }
    store.processEvent(asked)

    expect(store.state.permission.session).toEqual([request])
    expect(permissionEvents).toEqual([request])

    const replied: Event = {
      type: "permission.replied",
      properties: { sessionID: "session", requestID: "perm-1", reply: "once" },
    }
    store.processEvent(replied)

    expect(store.state.permission.session).toEqual([])
  })

  test("caps messages at 100 and removes parts", () => {
    const store = new SyncStore()
    store.processEvent({ type: "session.updated", properties: { info: makeSession("session") } })

    const firstMessage = makeAssistantMessage("msg-000")
    store.processEvent({ type: "message.updated", properties: { info: firstMessage } })
    store.processEvent({
      type: "message.part.updated",
      properties: { part: makeTextPart("part-000", firstMessage.id) },
    })

    for (let i = 1; i <= 100; i += 1) {
      const message = makeAssistantMessage(`msg-${String(i).padStart(3, "0")}`)
      store.processEvent({ type: "message.updated", properties: { info: message } })
    }

    expect(store.state.message.session.length).toBe(100)
    expect(store.state.part[firstMessage.id]).toBeUndefined()
  })

  test("emits assistant completion once", () => {
    const store = new SyncStore()
    const completions: string[] = []
    store.on("assistantMessageComplete", ({ message }) => completions.push(message.id))

    const message = makeAssistantMessage("msg-1", false)
    store.processEvent({ type: "message.updated", properties: { info: message } })
    store.processEvent({
      type: "message.updated",
      properties: { info: { ...message, time: { ...message.time, completed: Date.now() } } },
    })

    expect(completions).toEqual(["msg-1"])
  })
})
