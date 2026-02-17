import type {
  AdapterCapabilities,
  DerivedSessionStatus,
  FileAttachmentInfo,
  Message,
  MessageOrigin,
  Part,
  PermissionReply,
  PermissionRequest,
  QuestionReply,
  QuestionRequest,
  ReactionInfo,
  SessionInfo,
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
  onInboundMessage?(sessionID: string, text: string, origin: MessageOrigin): Promise<void>
  onFileAttachment?(sessionID: string, file: FileAttachmentInfo): Promise<void>
  onReaction?(sessionID: string, reaction: ReactionInfo): Promise<void>
  onSessionCreated?(sessionID: string, session: SessionInfo): Promise<void>
  onSessionDeleted?(sessionID: string): Promise<void>
}
