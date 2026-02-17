export { Binary } from "./binary"
export { TypedEmitter } from "./events"
export { HeadlessClient } from "./client"
export type { HeadlessClientConfig, HeadlessEventSource, ModelOverride, SessionPromptOptions } from "./client"
export type { ChannelAdapter } from "./adapter"
export { SyncStore, type TokenSummary } from "./store"
export { HeadlessRouter, type HeadlessRouterConfig } from "./router"
export { createFilePartInput, createFilePartInputFromBuffer, detectMimeType, filePartDataSize } from "./files"
export type { FilePartInput, CreateFilePartOptions } from "./files"
export type { MessageOrigin, FileAttachmentInfo, ReactionInfo, SessionInfo } from "./types"
export * from "./schemas"
export * from "./types"

import { HeadlessClient, type HeadlessClientConfig } from "./client"
import type { ChannelAdapter } from "./adapter"
import type { Logger } from "./types"
import { HeadlessRouter, type HeadlessRouterConfig } from "./router"
import { SyncStore } from "./store"

export type HeadlessConfig = {
  client: HeadlessClientConfig
  adapters: ChannelAdapter[]
  router?: Omit<HeadlessRouterConfig, "client" | "store" | "adapters">
  logger?: Logger
}

export function createHeadless(config: HeadlessConfig) {
  const client = new HeadlessClient(config.client)
  const store = new SyncStore()
  const router = new HeadlessRouter({
    client,
    store,
    adapters: config.adapters,
    logger: config.logger,
    ...(config.router ?? {}),
  })
  return { client, store, router }
}
