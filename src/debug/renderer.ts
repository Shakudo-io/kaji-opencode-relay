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
  SESSION: "blue",
  MESSAGE: "white",
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

  session(sessionID: string, info?: string): void {
    this.render("SESSION", info ? `${sessionID} — ${info}` : sessionID, { sessionID })
  }

  userMessage(sessionID: string, text: string): void {
    const truncated = text.length > 120 ? text.slice(0, 120) + "..." : text
    this.render("MESSAGE", `▶ User: "${truncated}"`, { sessionID, role: "user", text })
  }

  assistantText(sessionID: string, text: string): void {
    this.render("TEXT", text, { sessionID, role: "assistant" })
  }

  tool(sessionID: string, name: string, status: string, duration?: string): void {
    const msg = duration ? `${name}: ${status} (${duration})` : `${name}: ${status}`
    this.render("TOOL", msg, { sessionID, tool: name, status })
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
}
