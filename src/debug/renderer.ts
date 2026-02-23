import type { FileAttachmentInfo, MessageOrigin, ReactionInfo, SessionInfo } from "../types"

const isTTY = typeof process !== "undefined" && process.stdout?.isTTY === true

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  white: "\x1b[37m",
} as const

function c(color: keyof typeof COLORS, text: string, useColor: boolean): string {
  if (!useColor) return text
  return `${COLORS[color]}${text}${COLORS.reset}`
}

function timestamp(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`
}

const TAG_COLORS: Record<string, keyof typeof COLORS> = {
  CONNECTED: "green",
  DISCONNECTED: "red",
  RECONNECTING: "yellow",
  RECONNECTED: "green",
  BOOTSTRAP: "cyan",
  SESSION: "cyan",
  MESSAGE: "white",
  INBOUND: "white",
  TEXT: "white",
  TOOL: "magenta",
  PERMISSION: "yellow",
  QUESTION: "yellow",
  TODO: "cyan",
  STATUS: "blue",
  COMPLETE: "green",
  ERROR: "red",
  TOAST: "cyan",
  PROMPT: "green",
  THINKING: "dim",
  FILE: "cyan",
  MODEL: "blue",
  "MODEL CHANGED": "yellow",
  COST: "green",
  STEP: "dim",
  SUBTASK: "magenta",
  MCP: "cyan",
  REACTION: "yellow",
}

export type RendererOptions = {
  json?: boolean
  verbose?: boolean
  color?: boolean
}

export class ConsoleRenderer {
  private readonly json: boolean
  private readonly verbose: boolean
  private readonly color: boolean

  constructor(options: RendererOptions = {}) {
    this.json = options.json ?? false
    this.verbose = options.verbose ?? false
    this.color = options.color ?? isTTY
  }

  render(tag: string, message: string, details?: Record<string, unknown>): void {
    if (this.json) {
      const entry: Record<string, unknown> = {
        ts: new Date().toISOString(),
        type: tag.toLowerCase(),
        message,
        ...details,
      }
      process.stdout.write(JSON.stringify(entry) + "\n")
      return
    }

    const ts = c("dim", `[${timestamp()}]`, this.color)
    const tagColor = TAG_COLORS[tag] ?? "white"
    const tagStr = c(tagColor, `[${tag}]`, this.color)
    const pad = " ".repeat(Math.max(0, 14 - tag.length))
    process.stdout.write(`${ts} ${tagStr}${pad}${message}\n`)
  }

  renderVerbose(tag: string, raw: unknown): void {
    if (!this.verbose) return
    if (this.json) {
      const entry = { ts: new Date().toISOString(), type: `${tag.toLowerCase()}.raw`, raw }
      process.stdout.write(JSON.stringify(entry) + "\n")
      return
    }
    const ts = c("dim", `[${timestamp()}]`, this.color)
    const tagStr = c("dim", `[${tag}.RAW]`, this.color)
    process.stdout.write(`${ts} ${tagStr}  ${JSON.stringify(raw)}\n`)
  }

  connected(url: string): void {
    this.render("CONNECTED", `Connected to OpenCode at ${url}`)
  }

  disconnected(url: string): void {
    this.render("DISCONNECTED", `Lost connection to ${url}`)
  }

  reconnecting(attempt: number): void {
    this.render("RECONNECTING", `Reconnecting... (attempt ${attempt})`)
  }

  reconnected(attempt: number): void {
    this.render("RECONNECTED", `Reconnected (attempt ${attempt})`)
  }

  bootstrap(providers: number, agents: number, sessions: number): void {
    this.render("BOOTSTRAP", `Loaded ${providers} providers, ${agents} agents, ${sessions} sessions`)
  }

  mcpServers(servers: Array<{ name: string; status: string; error?: string }>): void {
    if (servers.length === 0) {
      this.render("MCP", "No MCP servers configured")
      return
    }
    const connected = servers.filter((s) => s.status === "connected")
    const failed = servers.filter((s) => s.status === "failed")
    const disabled = servers.filter((s) => s.status === "disabled")
    const other = servers.filter((s) => !["connected", "failed", "disabled"].includes(s.status))

    const summary = [`${servers.length} servers`]
    if (connected.length > 0) summary.push(`${connected.length} connected`)
    if (failed.length > 0) summary.push(`${failed.length} failed`)
    if (disabled.length > 0) summary.push(`${disabled.length} disabled`)
    if (other.length > 0) summary.push(`${other.length} other`)

    this.render("MCP", summary.join(", "), {
      total: servers.length,
      connected: connected.length,
      failed: failed.length,
      disabled: disabled.length,
      servers: servers.map((s) => ({ name: s.name, status: s.status, ...(s.error ? { error: s.error } : {}) })),
    })

    for (const server of servers) {
      const icon = server.status === "connected" ? "✅" : server.status === "failed" ? "❌" : server.status === "disabled" ? "⏸️" : "⚠️"
      const errorStr = server.error ? ` — ${server.error}` : ""
      this.render("MCP", `  ${icon} ${server.name} (${server.status})${errorStr}`)
    }
  }

  session(sessionID: string, info?: string): void {
    this.render("SESSION", info ? `${sessionID} — ${info}` : sessionID, { sessionID })
  }

  sessionCreated(sessionID: string, session: SessionInfo): void {
    const id = session.shortId ?? session.sessionId
    const project = session.projectName ?? "unknown"
    const directory = session.directory ?? "unknown"
    this.render("SESSION", `Session created: ${id} — project: ${project}, dir: ${directory}`, { sessionID, session })
  }

  sessionDeleted(sessionID: string): void {
    this.render("SESSION", `Session deleted: ${sessionID}`, { sessionID })
  }

  userMessage(sessionID: string, text: string): void {
    const truncated = text.length > 120 ? text.slice(0, 120) + "..." : text
    this.render("MESSAGE", `▶ User: "${truncated}"`, { sessionID, role: "user", text })
  }

  inboundMessage(sessionID: string, text: string, origin: MessageOrigin): void {
    const truncated = text.length > 120 ? text.slice(0, 120) + "..." : text
    this.render("INBOUND", `[${origin.adapterId}/${origin.channel}] User: ${truncated}`, { sessionID, origin, text })
  }

  assistantText(sessionID: string, text: string): void {
    this.render("TEXT", text, { sessionID, role: "assistant" })
  }

  tool(sessionID: string, name: string, status: string, duration?: string): void {
    const msg = duration ? `${name}: ${status} (${duration})` : `${name}: ${status}`
    this.render("TOOL", msg, { sessionID, tool: name, status })
  }

  toolFormatted(sessionID: string, name: string, status: string, formatted: string): void {
    this.render("TOOL", `${name}: ${status}\n${formatted}`, { sessionID, tool: name, status })
  }

  permission(sessionID: string, permission: string, reply: string): void {
    this.render("PERMISSION", `${permission} → ${reply}`, { sessionID, permission, reply })
  }

  question(sessionID: string, header: string, answer: string): void {
    this.render("QUESTION", `${header} → ${answer}`, { sessionID, header, answer })
  }

  todo(sessionID: string, count: number): void {
    this.render("TODO", `${count} todo(s) updated`, { sessionID, count })
  }

  status(sessionID: string, status: string): void {
    this.render("STATUS", `${sessionID} → ${status}`, { sessionID, status })
  }

  complete(sessionID: string, info?: string): void {
    this.render("COMPLETE", info ? `${sessionID} — ${info}` : `${sessionID} — response complete`, { sessionID })
  }

  error(sessionID: string, message: string): void {
    this.render("ERROR", `${sessionID}: ${message}`, { sessionID })
  }

  toast(variant: string, message: string): void {
    this.render("TOAST", `[${variant}] ${message}`, { variant })
  }

  prompt(sessionID: string, text: string): void {
    this.render("PROMPT", `→ Sent to ${sessionID}: "${text.length > 80 ? text.slice(0, 80) + "..." : text}"`, { sessionID, text })
  }

  idle(sessionID: string): void {
    this.render("STATUS", `${sessionID} → idle — waiting for input`, { sessionID, status: "idle" })
  }

  thinking(sessionID: string, text: string): void {
    const truncated = text.length > 200 ? text.slice(0, 200) + "..." : text
    this.render("THINKING", truncated, { sessionID, textLength: text.length })
  }

  file(sessionID: string, mime: string, filename: string | undefined, url: string): void {
    const sizeBytes = url.indexOf(";base64,") !== -1
      ? Math.floor(((url.length - url.indexOf(";base64,") - 8) * 3) / 4)
      : 0
    const sizeStr = sizeBytes > 1024 * 1024
      ? `${(sizeBytes / 1024 / 1024).toFixed(1)}MB`
      : sizeBytes > 1024
        ? `${(sizeBytes / 1024).toFixed(1)}KB`
        : `${sizeBytes}B`
    const name = filename ?? "(unnamed)"
    this.render("FILE", `${name} (${mime}, ${sizeStr})`, { sessionID, mime, filename, sizeBytes })
  }

  fileAttachment(sessionID: string, file: FileAttachmentInfo): void {
    const sizeStr = typeof file.size === "number" ? this.formatBytes(file.size) : "unknown"
    this.render("FILE", `📎 File: ${file.filename} (${file.mime}, ${sizeStr})`, { sessionID, file })
  }

  reaction(sessionID: string, reaction: ReactionInfo): void {
    this.render("REACTION", `${reaction.emoji} by ${reaction.userId}`, { sessionID, reaction })
  }

  modelInfo(sessionID: string, providerID: string, modelID: string, changed: boolean): void {
    const tag = changed ? "MODEL CHANGED" : "MODEL"
    this.render(tag, `${providerID}/${modelID}`, { sessionID, providerID, modelID, changed })
  }

  messageCost(sessionID: string, cost: number, tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }): void {
    const costStr = this.formatCost(cost)
    const tokenStr = tokens ? this.formatTokenBreakdown(tokens) : ""
    this.render("COST", `${costStr}${tokenStr ? ` | ${tokenStr}` : ""}`, {
      sessionID, cost,
      tokens: tokens ? { input: tokens.input ?? 0, output: tokens.output ?? 0, reasoning: tokens.reasoning ?? 0, cacheRead: tokens.cache?.read ?? 0, cacheWrite: tokens.cache?.write ?? 0 } : undefined,
    })
  }

  stepCost(sessionID: string, cost: number, tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }): void {
    const costStr = this.formatCost(cost)
    const tokenStr = tokens ? this.formatTokenBreakdown(tokens) : ""
    this.render("STEP", `${costStr}${tokenStr ? ` | ${tokenStr}` : ""}`, { sessionID, cost })
  }

  sessionSummary(sessionID: string, totalCost: number, tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }): void {
    const costStr = this.formatCost(totalCost)
    const totalTokens = tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite
    const tokenStr = this.formatTokenCount(totalTokens)
    this.render("SESSION", `Total: ${costStr} | ${tokenStr} tokens`, {
      sessionID, totalCost, totalTokens,
      tokens,
    })
  }

  subtask(sessionID: string, agent: string, description: string, model?: { providerID?: string; modelID?: string }): void {
    const desc = description.length > 80 ? description.slice(0, 80) + "..." : description
    const modelStr = model?.providerID && model?.modelID ? `, model=${model.providerID}/${model.modelID}` : ""
    this.render("SUBTASK", `agent=${agent}, "${desc}"${modelStr}`, { sessionID, agent, description })
  }

  subtaskRunning(sessionID: string, agentType: string, description: string, status: string, childSessionId?: string): void {
    const desc = description.length > 60 ? description.slice(0, 60) + "..." : description
    const childStr = childSessionId ? ` [${childSessionId.slice(0, 12)}]` : ""
    this.render("SUBTASK", `🕵️ ${agentType} — "${desc}" (${status})${childStr}`, { sessionID, agentType, description, status, childSessionId })
  }

  subtaskComplete(sessionID: string, agentType: string, description: string, elapsed: string, childSessionId?: string, output?: string): void {
    const desc = description.length > 60 ? description.slice(0, 60) + "..." : description
    const parts = [`✅ ${agentType} — "${desc}"`]
    if (elapsed) parts.push(`(${elapsed})`)
    const childStr = childSessionId ? ` [${childSessionId.slice(0, 12)}]` : ""
    this.render("SUBTASK", `${parts.join(" ")}${childStr}`, { sessionID, agentType, description, elapsed, childSessionId, outputLength: output?.length })
  }

  private formatCost(cost: number): string {
    if (cost === 0) return "$0.00"
    if (cost >= 1) return `$${cost.toFixed(2)}`
    if (cost >= 0.01) return `$${cost.toFixed(2)}`
    if (cost >= 0.001) return `$${cost.toFixed(3)}`
    return `$${cost.toFixed(4)}`
  }

  private formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`
    return `${bytes}B`
  }

  private formatTokenBreakdown(tokens: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }): string {
    const parts: string[] = []
    if (tokens.input) parts.push(`${this.formatTokenCount(tokens.input)} in`)
    if (tokens.output) parts.push(`${this.formatTokenCount(tokens.output)} out`)
    if (tokens.reasoning) parts.push(`${this.formatTokenCount(tokens.reasoning)} reasoning`)
    if (tokens.cache?.read) parts.push(`${this.formatTokenCount(tokens.cache.read)} cache`)
    return parts.join(" / ")
  }

  private formatTokenCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return String(n)
  }
}
