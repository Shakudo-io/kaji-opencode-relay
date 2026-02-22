import { describe, expect, test } from "bun:test"
import { SyncStore, isMessageFinal } from "../src/store"
import { cleanMetadata, formatElapsed, formatReasoning, formatTool } from "../src/render"
import type { Event, Message, Part, Session } from "../src/types"

const makeSession = (id: string): Session => ({
  id,
  slug: id,
  projectID: "project",
  directory: "/tmp/project",
  title: "Session",
  version: "1",
  time: { created: Date.now(), updated: Date.now() },
})

const makeUserMessage = (id: string): Message => ({
  id,
  sessionID: "session",
  role: "user",
  time: { created: Date.now() },
  parts: [],
} as unknown as Message)

const makeAssistantMessage = (id: string, opts: { completed?: boolean; finish?: string; cost?: number } = {}): Message => ({
  id,
  sessionID: "session",
  role: "assistant",
  time: { created: Date.now(), completed: opts.completed ? Date.now() : undefined },
  parentID: "parent",
  modelID: "model",
  providerID: "provider",
  mode: "build",
  agent: "build",
  path: { cwd: "/tmp/project", root: "/tmp" },
  cost: opts.cost ?? 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  finish: opts.finish,
} as unknown as Message)

const makeTextPart = (id: string, messageID: string, text: string): Part => ({
  id, sessionID: "session", messageID, type: "text", text,
} as Part)

const makeReasoningPart = (id: string, messageID: string, text: string): Part => ({
  id, sessionID: "session", messageID, type: "reasoning", text,
} as Part)

const makeToolPart = (id: string, messageID: string, tool: string, status: string, input = {}, output = ""): Part => ({
  id, sessionID: "session", messageID, type: "tool", callID: id, tool,
  state: status === "completed"
    ? { status: "completed", input, output, title: tool, metadata: {}, time: { start: 0, end: 1 } }
    : status === "running"
      ? { status: "running", input, time: { start: 0 } }
      : status === "error"
        ? { status: "error", input, error: "failed", time: { start: 0, end: 1 } }
        : { status: "pending", input, raw: "" },
} as Part)

const SID = "session"

const sessionEvent = (id: string): Event => ({ type: "session.updated", properties: { info: makeSession(id) } })
const msgEvent = (msg: Message): Event => ({ type: "message.updated", properties: { info: msg } })
const partEvent = (part: Part): Event => ({ type: "message.part.updated", properties: { part } })

describe("isMessageFinal", () => {
  test("returns false for finish: tool-calls", () => {
    expect(isMessageFinal(makeAssistantMessage("m", { finish: "tool-calls" }))).toBe(false)
  })
  test("returns false for finish: unknown", () => {
    expect(isMessageFinal(makeAssistantMessage("m", { finish: "unknown" }))).toBe(false)
  })
  test("returns true for finish: end_turn", () => {
    expect(isMessageFinal(makeAssistantMessage("m", { finish: "end_turn" }))).toBe(true)
  })
  test("returns true for finish: stop", () => {
    expect(isMessageFinal(makeAssistantMessage("m", { finish: "stop" }))).toBe(true)
  })
  test("returns false for finish: undefined", () => {
    expect(isMessageFinal(makeAssistantMessage("m"))).toBe(false)
  })
})

describe("SyncStore.sessionStatus", () => {
  test("throws for unknown sessionId", () => {
    const store = new SyncStore()
    expect(() => store.sessionStatus("does-not-exist")).toThrow("Session does-not-exist not found")
  })

  test("returns idle for session with no messages", () => {
    const store = new SyncStore()
    store.processEvent(sessionEvent(SID))
    expect(store.sessionStatus(SID)).toBe("idle")
  })

  test("returns working when last message is user message", () => {
    const store = new SyncStore()
    store.processEvent(sessionEvent(SID))
    store.processEvent(msgEvent(makeUserMessage("m1")))
    expect(store.sessionStatus(SID)).toBe("working")
  })

  test("returns working when last assistant message is not completed", () => {
    const store = new SyncStore()
    store.processEvent(sessionEvent(SID))
    store.processEvent(msgEvent(makeAssistantMessage("m1", { completed: false })))
    expect(store.sessionStatus(SID)).toBe("working")
  })

  test("returns idle when last assistant message is completed", () => {
    const store = new SyncStore()
    store.processEvent(sessionEvent(SID))
    store.processEvent(msgEvent(makeAssistantMessage("m1", { completed: true })))
    expect(store.sessionStatus(SID)).toBe("idle")
  })
})

describe("SyncStore.lastAssistantText", () => {
  test("throws for unknown sessionId", () => {
    const store = new SyncStore()
    expect(() => store.lastAssistantText("x")).toThrow()
  })

  test("returns empty string with no assistant messages", () => {
    const store = new SyncStore()
    store.processEvent(sessionEvent(SID))
    expect(store.lastAssistantText(SID)).toBe("")
  })

  test("returns concatenated text parts from last assistant message", () => {
    const store = new SyncStore()
    store.processEvent(sessionEvent(SID))
    const msg = makeAssistantMessage("m1")
    store.processEvent(msgEvent(msg))
    store.processEvent(partEvent(makeTextPart("p1", "m1", "Hello ")))
    store.processEvent(partEvent(makeTextPart("p2", "m1", "world")))
    expect(store.lastAssistantText(SID)).toBe("Hello world")
  })

  test("returns only text from LAST assistant message in multi-turn", () => {
    const store = new SyncStore()
    store.processEvent(sessionEvent(SID))
    const msg1 = makeAssistantMessage("m1")
    const msg2 = makeAssistantMessage("m2")
    store.processEvent(msgEvent(msg1))
    store.processEvent(msgEvent(msg2))
    store.processEvent(partEvent(makeTextPart("p1", "m1", "old response")))
    store.processEvent(partEvent(makeTextPart("p2", "m2", "new response")))
    expect(store.lastAssistantText(SID)).toBe("new response")
  })
})

describe("SyncStore.lastAssistantReasoning", () => {
  test("returns empty string when no reasoning parts", () => {
    const store = new SyncStore()
    store.processEvent(sessionEvent(SID))
    const msg = makeAssistantMessage("m1")
    store.processEvent(msgEvent(msg))
    store.processEvent(partEvent(makeTextPart("p1", "m1", "text only")))
    expect(store.lastAssistantReasoning(SID)).toBe("")
  })

  test("returns reasoning text when present", () => {
    const store = new SyncStore()
    store.processEvent(sessionEvent(SID))
    const msg = makeAssistantMessage("m1")
    store.processEvent(msgEvent(msg))
    store.processEvent(partEvent(makeReasoningPart("r1", "m1", "thinking deeply")))
    expect(store.lastAssistantReasoning(SID)).toBe("thinking deeply")
  })
})

describe("SyncStore.completedTools", () => {
  test("includes error-state tools", () => {
    const store = new SyncStore()
    store.processEvent(sessionEvent(SID))
    const msg = makeAssistantMessage("m1")
    store.processEvent(msgEvent(msg))
    store.processEvent(partEvent(makeToolPart("t1", "m1", "bash", "error")))
    const tools = store.completedTools(SID)
    expect(tools).toHaveLength(1)
    expect(tools[0]!.state.status).toBe("error")
  })

  test("returns empty array when no completed tools", () => {
    const store = new SyncStore()
    store.processEvent(sessionEvent(SID))
    const msg = makeAssistantMessage("m1")
    store.processEvent(msgEvent(msg))
    store.processEvent(partEvent(makeToolPart("t1", "m1", "bash", "running")))
    expect(store.completedTools(SID)).toHaveLength(0)
  })
})

describe("SyncStore.activeTools", () => {
  test("returns running tools", () => {
    const store = new SyncStore()
    store.processEvent(sessionEvent(SID))
    const msg = makeAssistantMessage("m1")
    store.processEvent(msgEvent(msg))
    store.processEvent(partEvent(makeToolPart("t1", "m1", "bash", "running")))
    const tools = store.activeTools(SID)
    expect(tools).toHaveLength(1)
    expect(tools[0]!.tool).toBe("bash")
  })
})

describe("SyncStore.sessionCostBreakdown", () => {
  test("returns zeros with no messages", () => {
    const store = new SyncStore()
    store.processEvent(sessionEvent(SID))
    expect(store.sessionCostBreakdown(SID)).toEqual({ perMessage: 0, cumulative: 0 })
  })

  test("perMessage reflects last message cost, cumulative is total", () => {
    const store = new SyncStore()
    store.processEvent(sessionEvent(SID))
    store.processEvent(msgEvent(makeAssistantMessage("m1", { completed: true, cost: 0.10 })))
    store.processEvent(msgEvent(makeAssistantMessage("m2", { completed: true, cost: 0.15 })))
    const breakdown = store.sessionCostBreakdown(SID)
    expect(breakdown.perMessage).toBe(0.15)
    expect(breakdown.cumulative).toBeGreaterThanOrEqual(0.10)
  })
})

describe("formatElapsed", () => {
  test("< 60s", () => expect(formatElapsed(5000)).toBe("5s"))
  test("minutes", () => expect(formatElapsed(150000)).toBe("2m 30s"))
  test("exact minute", () => expect(formatElapsed(120000)).toBe("2m"))
  test("hours", () => expect(formatElapsed(3900000)).toBe("1h 5m"))
  test("exact hour", () => expect(formatElapsed(3600000)).toBe("1h"))
})

describe("cleanMetadata", () => {
  test("strips task_metadata tags", () => {
    const text = "before<task_metadata>noise</task_metadata>after"
    expect(cleanMetadata(text)).toBe("beforeafter")
  })
  test("strips background task noise", () => {
    const text = "Task ID: abc123  "
    expect(cleanMetadata(text)).toBe("")
  })
  test("passes through clean text", () => {
    expect(cleanMetadata("hello world")).toBe("hello world")
  })
})

describe("formatReasoning", () => {
  test("wraps short text in blockquote", () => {
    expect(formatReasoning("thinking")).toBe("> _thinking_")
  })
  test("truncates long text at maxChars", () => {
    const long = "x".repeat(700)
    const result = formatReasoning(long)
    expect(result.length).toBeLessThan(700)
    expect(result).toContain("...")
    expect(result.startsWith("> _")).toBe(true)
  })
  test("returns empty string for empty input", () => {
    expect(formatReasoning("")).toBe("")
  })
})

describe("formatTool dispatch", () => {
  const bashPart = makeToolPart("t1", "m1", "bash", "completed", { command: "echo hi" }, "hi\n") as unknown as Extract<Part, { type: "tool" }>
  const editPart = makeToolPart("t2", "m1", "edit", "completed", { filePath: "foo.ts" }, "- old\n+ new") as unknown as Extract<Part, { type: "tool" }>
  const readPart = makeToolPart("t3", "m1", "read", "completed", { filePath: "bar.ts" }, "content") as unknown as Extract<Part, { type: "tool" }>

  test("bash → contains bash block", () => {
    const result = formatTool(bashPart)
    expect(result).toContain("```bash")
  })
  test("edit → contains diff block", () => {
    const result = formatTool(editPart)
    expect(result).toContain("📝")
  })
  test("read → generic output", () => {
    const result = formatTool(readPart)
    expect(result).toContain("read")
  })
})
