import { describe, expect, test } from "bun:test"
import { createContextualLogger, noopContextualLogger, type Logger } from "../src/types"

type LogEntry = {
  level: "debug" | "info" | "warn" | "error"
  message: string
  args: unknown[]
}

const createRecordingLogger = () => {
  const entries: LogEntry[] = []
  const logger: Logger = {
    debug: (message, ...args) => entries.push({ level: "debug", message, args }),
    info: (message, ...args) => entries.push({ level: "info", message, args }),
    warn: (message, ...args) => entries.push({ level: "warn", message, args }),
    error: (message, ...args) => entries.push({ level: "error", message, args }),
  }

  return { entries, logger }
}

describe("ContextualLogger", () => {
  test("appends context to log calls", () => {
    const { entries, logger } = createRecordingLogger()
    const contextual = createContextualLogger(logger, { sessionId: "session-1" })

    contextual.info("hello", { step: 1 })

    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual({
      level: "info",
      message: "hello",
      args: [{ step: 1 }, { sessionId: "session-1" }],
    })
  })

  test("child merges parent context", () => {
    const { entries, logger } = createRecordingLogger()
    const root = createContextualLogger(logger, { sessionId: "session-1", userId: "user-1" })
    const child = root.child({ requestId: "req-1" })
    const grandchild = child.child({ requestId: "req-2", traceId: "trace-1" })

    root.debug("root")
    child.warn("child")
    grandchild.error("grandchild")

    expect(entries).toEqual([
      {
        level: "debug",
        message: "root",
        args: [{ sessionId: "session-1", userId: "user-1" }],
      },
      {
        level: "warn",
        message: "child",
        args: [{ sessionId: "session-1", userId: "user-1", requestId: "req-1" }],
      },
      {
        level: "error",
        message: "grandchild",
        args: [
          { sessionId: "session-1", userId: "user-1", requestId: "req-2", traceId: "trace-1" },
        ],
      },
    ])
  })

  test("logs all levels with context", () => {
    const { entries, logger } = createRecordingLogger()
    const contextual = createContextualLogger(logger, { sessionId: "session-2" })

    contextual.debug("debug")
    contextual.info("info")
    contextual.warn("warn")
    contextual.error("error")

    expect(entries.map((entry) => entry.level)).toEqual(["debug", "info", "warn", "error"])
    for (const entry of entries) {
      expect(entry.args).toEqual([{ sessionId: "session-2" }])
    }
  })

  test("noop contextual logger returns itself", () => {
    const child = noopContextualLogger.child({ sessionId: "ignored" })
    expect(child).toBe(noopContextualLogger)
    expect(() => noopContextualLogger.debug("debug")).not.toThrow()
    expect(() => noopContextualLogger.info("info")).not.toThrow()
    expect(() => noopContextualLogger.warn("warn")).not.toThrow()
    expect(() => noopContextualLogger.error("error")).not.toThrow()
  })
})
