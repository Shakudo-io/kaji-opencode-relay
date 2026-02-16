import type { ChannelAdapter } from "../adapter"
import type {
  AdapterCapabilities,
  DerivedSessionStatus,
  Message,
  Part,
  PermissionReply,
  PermissionRequest,
  QuestionReply,
  QuestionRequest,
  Todo,
  ToastNotification,
} from "../types"
import type { ConsoleRenderer } from "./renderer"

export type DebugAdapterOptions = {
  renderer: ConsoleRenderer
  permissionPolicy?: "approve-all" | "reject-all" | "interactive"
  questionPolicy?: "first-option" | "interactive"
  permissionTimeout?: number
  questionTimeout?: number
  onInteractivePermission?: (sessionID: string, request: PermissionRequest) => Promise<PermissionReply>
  onInteractiveQuestion?: (sessionID: string, request: QuestionRequest) => Promise<QuestionReply>
}

export class DebugAdapter implements ChannelAdapter {
  readonly id = "debug"
  readonly channel = "console"
  readonly capabilities: AdapterCapabilities = {
    streaming: false,
    richFormatting: false,
    interactiveButtons: false,
    fileUpload: false,
    diffViewer: false,
    codeBlocks: true,
  }

  private readonly renderer: ConsoleRenderer
  private readonly permissionPolicy: "approve-all" | "reject-all" | "interactive"
  private readonly questionPolicy: "first-option" | "interactive"
  private readonly onInteractivePermission?: (sessionID: string, request: PermissionRequest) => Promise<PermissionReply>
  private readonly onInteractiveQuestion?: (sessionID: string, request: QuestionRequest) => Promise<QuestionReply>

  constructor(options: DebugAdapterOptions) {
    this.renderer = options.renderer
    this.permissionPolicy = options.permissionPolicy ?? "approve-all"
    this.questionPolicy = options.questionPolicy ?? "first-option"
    this.onInteractivePermission = options.onInteractivePermission
    this.onInteractiveQuestion = options.onInteractiveQuestion
  }

  async onAssistantMessage(sessionID: string, message: Message, parts: Part[]): Promise<void> {
    if (message.role !== "assistant") return
    for (const part of parts) {
      const record = part as Record<string, unknown>
      switch (part.type) {
        case "text": {
          const textValue = (typeof record.text === "string" ? record.text : undefined)
            ?? (typeof record.content === "string" ? record.content : undefined)
          if (textValue) {
            this.renderer.assistantText(sessionID, textValue)
          }
          break
        }
        case "tool": {
          const name = typeof record.tool === "string" ? record.tool : "unknown"
          const state = record.state as Record<string, unknown> | undefined
          const status = state?.type as string ?? "pending"
          this.renderer.tool(sessionID, name, status)
          break
        }
        case "reasoning": {
          const text = typeof record.text === "string" ? record.text : ""
          this.renderer.thinking(sessionID, text)
          break
        }
        case "file": {
          const mime = typeof record.mime === "string" ? record.mime : "unknown"
          const filename = typeof record.filename === "string" ? record.filename : undefined
          const url = typeof record.url === "string" ? record.url : ""
          this.renderer.file(sessionID, mime, filename, url)
          break
        }
      }
    }
  }

  async onAssistantMessageComplete(sessionID: string, _message: Message, _parts: Part[]): Promise<void> {
    this.renderer.complete(sessionID)
  }

  async onPermissionRequest(sessionID: string, request: PermissionRequest): Promise<PermissionReply> {
    const req = request as Record<string, unknown>
    const permissionType = (typeof req.permission === "string" ? req.permission : "unknown")

    if (this.permissionPolicy === "interactive" && this.onInteractivePermission) {
      this.renderer.permission(sessionID, permissionType, "prompting...")
      return this.onInteractivePermission(sessionID, request)
    }

    const reply: PermissionReply["reply"] = this.permissionPolicy === "reject-all" ? "reject" : "once"
    this.renderer.permission(sessionID, permissionType, reply)
    return { reply }
  }

  async onQuestionRequest(sessionID: string, request: QuestionRequest): Promise<QuestionReply> {
    const req = request as Record<string, unknown>
    const questions = req.questions as Array<Record<string, unknown>> | undefined
    const header = questions?.[0]?.header as string ?? "question"

    if (this.questionPolicy === "interactive" && this.onInteractiveQuestion) {
      this.renderer.question(sessionID, header, "prompting...")
      return this.onInteractiveQuestion(sessionID, request)
    }

    const answers: string[][] = []
    if (questions) {
      for (const q of questions) {
        const options = q.options as Array<Record<string, unknown>> | undefined
        if (options && options.length > 0) {
          answers.push([options[0]!.label as string])
        } else {
          answers.push([])
        }
      }
    }
    this.renderer.question(sessionID, header, `auto: ${JSON.stringify(answers)}`)
    return { answers }
  }

  onSessionStatus(sessionID: string, status: DerivedSessionStatus): void {
    if (status === "idle") {
      this.renderer.idle(sessionID)
    } else {
      this.renderer.status(sessionID, status)
    }
  }

  onTodoUpdate(sessionID: string, todos: Todo[]): void {
    this.renderer.todo(sessionID, todos.length)
  }

  onSessionError(sessionID: string, error: Error): void {
    this.renderer.error(sessionID, error.message)
  }

  onToast(notification: ToastNotification): void {
    this.renderer.toast(notification.variant, notification.message)
  }
}
