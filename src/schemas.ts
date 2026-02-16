import { z } from "zod"

export const PermissionReplySchema = z.object({
  reply: z.enum(["once", "always", "reject"]),
  message: z.string().optional(),
})

export const QuestionReplySchema = z.union([
  z.object({
    answers: z.array(z.array(z.string())),
  }),
  z.object({
    rejected: z.literal(true),
  }),
])

export const ToastNotificationSchema = z.object({
  variant: z.enum(["error", "warning", "success", "info"]),
  message: z.string(),
  duration: z.number().optional(),
})

export const AdapterCapabilitiesSchema = z.object({
  streaming: z.boolean(),
  richFormatting: z.boolean(),
  interactiveButtons: z.boolean(),
  fileUpload: z.boolean(),
  diffViewer: z.boolean(),
  codeBlocks: z.boolean(),
})

const EventSourceSchema = z.object({
  on: z.function(),
})

const LoggerSchema = z.object({
  debug: z.function(),
  info: z.function(),
  warn: z.function(),
  error: z.function(),
})

export const HeadlessClientConfigSchema = z.object({
  url: z.string(),
  directory: z.string().optional(),
  fetch: z.custom<typeof fetch>((value) => typeof value === "function").optional(),
  headers: z.record(z.string()).optional(),
  events: EventSourceSchema.optional(),
  batchInterval: z.number().positive().optional(),
  logger: LoggerSchema.optional(),
  sdk: z.unknown().optional(),
  createClient: z.function().optional(),
})
