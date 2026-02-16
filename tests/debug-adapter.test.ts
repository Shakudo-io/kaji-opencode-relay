import { describe, expect, test } from "bun:test"
import { DebugAdapter } from "../src/debug/adapter"
import { ConsoleRenderer } from "../src/debug/renderer"
import type { Message, Part, PermissionRequest, QuestionRequest, Todo, ToastNotification } from "../src/types"

const captured: string[] = []
const originalWrite = process.stdout.write
function captureStdout() {
  captured.length = 0
  process.stdout.write = (chunk: string | Uint8Array) => {
    captured.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk))
    return true
  }
}
function restoreStdout() {
  process.stdout.write = originalWrite
}

const renderer = new ConsoleRenderer({ json: true, color: false })

describe("DebugAdapter", () => {
  test("auto-approves permissions with approve-all policy", async () => {
    const adapter = new DebugAdapter({ renderer, permissionPolicy: "approve-all" })
    captureStdout()
    const reply = await adapter.onPermissionRequest("ses1", {
      id: "perm1",
      sessionID: "ses1",
      permission: "bash",
      metadata: { command: "ls" },
    } as PermissionRequest)
    restoreStdout()
    expect(reply).toEqual({ reply: "once" })
    expect(captured.some((l) => l.includes('"reply":"once"'))).toBe(true)
  })

  test("auto-rejects permissions with reject-all policy", async () => {
    const adapter = new DebugAdapter({ renderer, permissionPolicy: "reject-all" })
    captureStdout()
    const reply = await adapter.onPermissionRequest("ses1", {
      id: "perm1",
      sessionID: "ses1",
      permission: "edit",
    } as PermissionRequest)
    restoreStdout()
    expect(reply).toEqual({ reply: "reject" })
  })

  test("auto-selects first option for questions", async () => {
    const adapter = new DebugAdapter({ renderer, questionPolicy: "first-option" })
    captureStdout()
    const reply = await adapter.onQuestionRequest("ses1", {
      id: "q1",
      sessionID: "ses1",
      questions: [
        { question: "Pick one", header: "Choice", options: [{ label: "A", description: "Option A" }, { label: "B", description: "Option B" }] },
      ],
    } as QuestionRequest)
    restoreStdout()
    expect("answers" in reply).toBe(true)
    if ("answers" in reply) {
      expect(reply.answers).toEqual([["A"]])
    }
  })

  test("renders assistant text parts", async () => {
    const adapter = new DebugAdapter({ renderer })
    const msg: Message = { id: "m1", role: "assistant", sessionID: "ses1", time: {} } as Message
    const parts: Part[] = [{ id: "p1", messageID: "m1", type: "text", content: "Hello world", sessionID: "ses1" } as Part]
    captureStdout()
    await adapter.onAssistantMessage("ses1", msg, parts)
    restoreStdout()
    expect(captured.some((l) => l.includes("Hello world"))).toBe(true)
  })

  test("renders tool parts", async () => {
    const adapter = new DebugAdapter({ renderer })
    const msg: Message = { id: "m1", role: "assistant", sessionID: "ses1", time: {} } as Message
    const parts: Part[] = [{ id: "p1", messageID: "m1", type: "tool", tool: "bash", state: { type: "running" }, sessionID: "ses1" } as Part]
    captureStdout()
    await adapter.onAssistantMessage("ses1", msg, parts)
    restoreStdout()
    expect(captured.some((l) => l.includes("bash"))).toBe(true)
  })

  test("renders completion", async () => {
    const adapter = new DebugAdapter({ renderer })
    const msg: Message = { id: "m1", role: "assistant", sessionID: "ses1", time: { completed: "2026-01-01" } } as Message
    captureStdout()
    await adapter.onAssistantMessageComplete("ses1", msg, [])
    restoreStdout()
    expect(captured.some((l) => l.includes("complete"))).toBe(true)
  })

  test("renders session status and idle", () => {
    const adapter = new DebugAdapter({ renderer })
    captureStdout()
    adapter.onSessionStatus("ses1", "working")
    adapter.onSessionStatus("ses1", "idle")
    restoreStdout()
    expect(captured.some((l) => l.includes("working"))).toBe(true)
    expect(captured.some((l) => l.includes("idle"))).toBe(true)
  })

  test("renders todo updates", () => {
    const adapter = new DebugAdapter({ renderer })
    captureStdout()
    adapter.onTodoUpdate("ses1", [{} as Todo, {} as Todo])
    restoreStdout()
    expect(captured.some((l) => l.includes("2 todo"))).toBe(true)
  })

  test("renders errors and toasts", () => {
    const adapter = new DebugAdapter({ renderer })
    captureStdout()
    adapter.onSessionError("ses1", new Error("something broke"))
    adapter.onToast({ variant: "warning", message: "heads up" })
    restoreStdout()
    expect(captured.some((l) => l.includes("something broke"))).toBe(true)
    expect(captured.some((l) => l.includes("heads up"))).toBe(true)
  })
})
