import type { Event } from "@opencode-ai/sdk/v2"

export type {
  Agent,
  Command,
  Config,
  Event,
  FileDiff,
  FormatterStatus,
  LspStatus,
  McpResource,
  McpStatus,
  Message,
  OpencodeClient,
  OpencodeClientConfig,
  Part,
  Path,
  PermissionRequest,
  Provider,
  ProviderAuthMethod,
  ProviderListResponse,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
  VcsInfo,
} from "@opencode-ai/sdk/v2"

export interface Logger {
  debug(msg: string, ...args: unknown[]): void
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
}

export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

export type SSEEvent = Event

export type DerivedSessionStatus = "idle" | "working" | "compacting"

export interface PermissionReply {
  reply: "once" | "always" | "reject"
  message?: string
}

export type QuestionReply = { answers: string[][] } | { rejected: true }

export interface ToastNotification {
  variant: "error" | "warning" | "success" | "info"
  message: string
  duration?: number
}

export interface AdapterCapabilities {
  streaming: boolean
  richFormatting: boolean
  interactiveButtons: boolean
  fileUpload: boolean
  diffViewer: boolean
  codeBlocks: boolean
}

export type MessageOrigin = {
  adapterId: string
  channel: string
  userId?: string
  username?: string
}

export type FileAttachmentInfo = {
  mime: string
  filename: string
  url: string
  size?: number
}

export type ReactionInfo = {
  emoji: string
  userId: string
  messageId?: string
}

export type SessionInfo = {
  sessionId: string
  shortId?: string
  projectName?: string
  directory?: string
  title?: string
}
