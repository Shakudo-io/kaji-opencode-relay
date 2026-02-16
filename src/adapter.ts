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
} from "./types"

export interface ChannelAdapter {
  readonly id: string
  readonly channel: string
  readonly capabilities: AdapterCapabilities
  initialize?(): Promise<void>
  shutdown?(): Promise<void>
  onAssistantMessage(sessionID: string, message: Message, parts: Part[]): Promise<void>
  onAssistantMessageComplete(sessionID: string, message: Message, parts: Part[]): Promise<void>
  onPermissionRequest(sessionID: string, request: PermissionRequest): Promise<PermissionReply>
  onQuestionRequest(sessionID: string, request: QuestionRequest): Promise<QuestionReply>
  onSessionStatus(sessionID: string, status: DerivedSessionStatus): void
  onTodoUpdate(sessionID: string, todos: Todo[]): void
  onSessionError(sessionID: string, error: Error): void
  onToast(notification: ToastNotification): void
}
