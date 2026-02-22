import type { Part } from "./types"

type ToolPart = Extract<Part, { type: "tool" }>

export interface FormatBashOptions {
  maxLines?: number
}

export interface FormatReasoningOptions {
  maxChars?: number
}

export function cleanMetadata(text: string): string {
  return text
    .replace(/<task_metadata>[\s\S]*?<\/task_metadata>/g, "")
    .replace(/to continue: task\(session_id=[\s\S]*?\)/g, "")
    .replace(/Background task launched[\s\S]*?(?:background_output|to check)[^\n]*/g, "")
    .replace(/Task ID: \S+\s*/g, "")
    .replace(/Agent: \S+\s*Status: \S+\s*/g, "")
    .replace(/System notifies on completion\.\s*/g, "")
    .replace(/Description: [^\n]*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function formatElapsed(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`
}

function cleanBashCommand(cmd: string): string {
  return cmd
    .split(";")
    .map((s) => s.trim())
    .filter((s) => !/^export\s+\w+=/.test(s))
    .join("; ")
    .trim()
}

export function formatBashOutput(part: ToolPart, opts?: FormatBashOptions): string {
  const maxLines = opts?.maxLines ?? 20
  const state = part.state
  const input = state.input as Record<string, unknown>
  const command = cleanBashCommand((input?.command as string) ?? "")

  if (state.status === "running" || state.status === "pending") {
    const output = (state as Record<string, unknown>).output as string | undefined
    if (!output) return `\`\`\`bash\n$ ${command}\n_(running...)_\n\`\`\``
    const lines = output.trim().split("\n")
    const shown = lines.length > maxLines
      ? `... (${lines.length - maxLines} lines hidden)\n${lines.slice(-maxLines).join("\n")}`
      : output.trim()
    return `\`\`\`bash\n$ ${command}\n${shown}\n\`\`\``
  }

  if (state.status === "completed" || state.status === "error") {
    const output = state.status === "completed"
      ? (state.output ?? "")
      : (state as Record<string, unknown>).error as string ?? ""
    const lines = output.trim().split("\n")
    const shown = lines.length > maxLines
      ? `... (${lines.length - maxLines} lines hidden)\n${lines.slice(-maxLines).join("\n")}`
      : output.trim()
    const prefix = command ? `$ ${command}\n` : ""
    return `\`\`\`bash\n${prefix}${shown}\n\`\`\``
  }

  return ""
}

export function formatEditDiff(part: ToolPart): string {
  const input = part.state.input as Record<string, unknown>
  const filePath = (input?.filePath ?? input?.file_path ?? input?.path ?? "unknown") as string
  const meta = (part.state as Record<string, unknown>).metadata as Record<string, unknown> | undefined
  const diff = (meta?.diff ?? (part.state.status === "completed" ? part.state.output : "")) as string ?? ""
  if (!diff) return `📝 **${filePath}** _(no diff available)_`
  return `📝 **${filePath}**\n\`\`\`diff\n${diff}\n\`\`\``
}

export function formatToolOutput(part: ToolPart): string {
  const input = part.state.input as Record<string, unknown>
  const label = (input?.filePath ?? input?.file_path ?? input?.pattern ?? input?.path ?? "") as string
  const output = part.state.status === "completed"
    ? (part.state.output ?? "")
    : part.state.status === "error"
      ? ((part.state as Record<string, unknown>).error as string ?? "")
      : ""
  if (!output) return `**${part.tool}**${label ? ` \`${label}\`` : ""} _(no output)_`
  return `**${part.tool}**${label ? ` \`${label}\`` : ""}\n\`\`\`\n${output}\n\`\`\``
}

export function formatReasoning(text: string, opts?: FormatReasoningOptions): string {
  if (!text) return ""
  const maxChars = opts?.maxChars ?? 600
  const truncated = text.length > maxChars
    ? text.slice(0, Math.max(1, text.lastIndexOf(" ", maxChars) > 0 ? text.lastIndexOf(" ", maxChars) : maxChars)) + "..."
    : text
  return `> _${truncated}_`
}

export function formatTool(part: ToolPart, opts?: FormatBashOptions): string {
  switch (part.tool) {
    case "bash": return formatBashOutput(part, opts)
    case "edit":
    case "write": return formatEditDiff(part)
    default: return formatToolOutput(part)
  }
}
