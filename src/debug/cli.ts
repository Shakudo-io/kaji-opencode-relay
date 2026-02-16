import { HeadlessClient } from "../client"
import { SyncStore } from "../store"
import { HeadlessRouter } from "../router"
import { DebugAdapter } from "./adapter"
import { ConsoleRenderer } from "./renderer"
import { createFilePartInput, type FilePartInput } from "../files"
import type { PermissionReply, PermissionRequest, QuestionReply, QuestionRequest } from "../types"
import { createInterface } from "readline"

type CLIArgs = {
  url: string
  directory?: string
  session?: string
  interactive: boolean
  json: boolean
  verbose: boolean
}

function parseArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = { url: "", interactive: false, json: false, verbose: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case "--url":
        args.url = argv[++i] ?? ""
        break
      case "--directory":
        args.directory = argv[++i]
        break
      case "--session":
        args.session = argv[++i]
        break
      case "--interactive":
        args.interactive = true
        break
      case "--json":
        args.json = true
        break
      case "--verbose":
        args.verbose = true
        break
    }
  }
  if (!args.url) {
    process.stderr.write("Error: --url is required\nUsage: kaji-opencode-relay-debug --url http://localhost:4096 [--session <id>] [--interactive] [--json] [--verbose]\n")
    process.exit(1)
  }
  return args
}

function createStdinPromptReader(): (prompt: string) => Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: process.stdin.isTTY ?? false })
  return (prompt: string) => new Promise((resolve) => rl.question(prompt, resolve))
}

function createInteractivePermissionHandler(
  readLine: (prompt: string) => Promise<string>,
  renderer: ConsoleRenderer,
  defaultTimeout: number,
): (sessionID: string, request: PermissionRequest) => Promise<PermissionReply> {
  return async (sessionID, request) => {
    const req = request as Record<string, unknown>
    const permission = typeof req.permission === "string" ? req.permission : "unknown"
    const metadata = req.metadata as Record<string, unknown> | undefined

    let detail = permission
    if (metadata?.command) detail += `: ${metadata.command}`
    else if (metadata?.filepath) detail += `: ${metadata.filepath}`

    const prompt = `\n[PERMISSION] ${detail}\n  1) Allow once\n  2) Allow always\n  3) Reject\n  > `

    const answer = await Promise.race([
      readLine(prompt),
      new Promise<string>((resolve) => setTimeout(() => resolve("1"), defaultTimeout)),
    ])

    const choice = answer.trim()
    if (choice === "2") {
      renderer.permission(sessionID, permission, "always")
      return { reply: "always" as const }
    }
    if (choice === "3") {
      renderer.permission(sessionID, permission, "reject")
      return { reply: "reject" as const }
    }
    renderer.permission(sessionID, permission, "once")
    return { reply: "once" as const }
  }
}

function createInteractiveQuestionHandler(
  readLine: (prompt: string) => Promise<string>,
  renderer: ConsoleRenderer,
  defaultTimeout: number,
): (sessionID: string, request: QuestionRequest) => Promise<QuestionReply> {
  return async (sessionID, request) => {
    const req = request as Record<string, unknown>
    const questions = req.questions as Array<Record<string, unknown>> | undefined
    if (!questions || questions.length === 0) return { rejected: true }

    const answers: string[][] = []
    for (const q of questions) {
      const header = q.header as string ?? "Question"
      const questionText = q.question as string ?? ""
      const options = q.options as Array<Record<string, unknown>> | undefined
      const allowCustom = q.custom !== false

      let prompt = `\n[QUESTION] ${header}: ${questionText}\n`
      if (options) {
        options.forEach((opt, i) => {
          prompt += `  ${i + 1}) ${opt.label}${opt.description ? ` — ${opt.description}` : ""}\n`
        })
      }
      if (allowCustom) prompt += `  Type a custom answer, or enter number(s) comma-separated\n`
      prompt += `  > `

      const answer = await Promise.race([
        readLine(prompt),
        new Promise<string>((resolve) => setTimeout(() => resolve("1"), defaultTimeout)),
      ])

      const trimmed = answer.trim()
      const nums = trimmed.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n))
      if (nums.length > 0 && options) {
        const selected = nums.map((n) => (options[n - 1] as Record<string, unknown>)?.label as string).filter(Boolean)
        answers.push(selected)
      } else {
        answers.push([trimmed])
      }
      renderer.question(sessionID, header, JSON.stringify(answers[answers.length - 1]))
    }
    return { answers }
  }
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv)
  const renderer = new ConsoleRenderer({ json: args.json, verbose: args.verbose })
  const readLine = args.interactive ? createStdinPromptReader() : undefined
  const client = new HeadlessClient({ url: args.url, directory: args.directory })
  const store = new SyncStore()

  const adapter = new DebugAdapter({
    renderer,
    store,
    permissionPolicy: args.interactive ? "interactive" : "approve-all",
    questionPolicy: args.interactive ? "interactive" : "first-option",
    onInteractivePermission: readLine
      ? createInteractivePermissionHandler(readLine, renderer, 60_000)
      : undefined,
    onInteractiveQuestion: readLine
      ? createInteractiveQuestionHandler(readLine, renderer, 60_000)
      : undefined,
  })
  const router = new HeadlessRouter({
    client,
    store,
    adapters: [adapter],
    defaultAdapterId: "debug",
  })

  client.on("connected", ({ url }) => renderer.connected(url))
  client.on("disconnected", ({ url }) => renderer.disconnected(url))
  client.on("reconnecting", ({ attempt }) => renderer.reconnecting(attempt))
  client.on("reconnected", ({ attempt }) => renderer.reconnected(attempt))
  client.on("error", ({ error }) => renderer.render("ERROR", error.message))

  if (args.verbose) {
    client.on("event", (event) => renderer.renderVerbose("EVENT", event))
  }

  await client.connect()
  await client.bootstrap(store)

  const providers = store.state.provider.length
  const agents = store.state.agent.length
  const sessions = store.state.session.length
  renderer.bootstrap(providers, agents, sessions)

  const mcpEntries = Object.entries(store.state.mcp)
  if (mcpEntries.length > 0) {
    renderer.mcpServers(mcpEntries.map(([name, status]) => {
      const s = status as Record<string, unknown>
      return { name, status: s.status as string, error: s.error as string | undefined }
    }))
  }

  if (args.session) {
    router.setSessionAdapter(args.session, "debug")
  }

  await startInputLoop(client, store, renderer, args, readLine)

  const shutdown = async () => {
    renderer.render("STATUS", "Shutting down...")
    await router.shutdown()
    client.disconnect()
    process.exit(0)
  }

  process.on("SIGINT", () => void shutdown())
  process.on("SIGTERM", () => void shutdown())
}

async function startInputLoop(
  client: HeadlessClient,
  store: SyncStore,
  renderer: ConsoleRenderer,
  args: CLIArgs,
  readLine?: (prompt: string) => Promise<string>,
): Promise<void> {
  if (!readLine && !process.stdin.isTTY) return

  const reader = readLine ?? createStdinPromptReader()
  let currentSessionID = args.session
  const pendingFiles: FilePartInput[] = []

  const promptLoop = async () => {
    while (true) {
      const input = await reader(pendingFiles.length > 0 ? `[${pendingFiles.length} file(s)] > ` : "> ")
      const text = input.trim()
      if (!text) continue

      if (text.startsWith("/attach ")) {
        const filePath = text.slice(8).trim()
        try {
          const filePart = await createFilePartInput(filePath)
          pendingFiles.push(filePart)
          renderer.render("ATTACH", `Queued: ${filePart.filename} (${filePart.mime})`)
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error))
          renderer.render("ERROR", `Failed to attach file: ${err.message}`)
        }
        continue
      }

      if (!currentSessionID) {
        const existingSessions = store.state.session
        if (existingSessions.length > 0) {
          currentSessionID = existingSessions[existingSessions.length - 1]!.id
        } else {
          try {
            const raw = await client.createSession() as Record<string, unknown>
            const session = (raw.data ?? raw) as Record<string, unknown>
            currentSessionID = session.id as string
            renderer.session(currentSessionID, "auto-created")
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error))
            renderer.render("ERROR", `Failed to create session: ${err.message}`)
            continue
          }
        }
      }

      try {
        if (pendingFiles.length > 0) {
          const files = [...pendingFiles]
          pendingFiles.length = 0
          await client.promptWithFiles(currentSessionID, text, files)
          renderer.prompt(currentSessionID, `${text} [+${files.length} file(s)]`)
        } else {
          await client.prompt(currentSessionID, text)
          renderer.prompt(currentSessionID, text)
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        renderer.render("ERROR", `Prompt failed: ${err.message}`)
      }
    }
  }

  void promptLoop()
}
