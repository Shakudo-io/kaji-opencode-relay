#!/usr/bin/env bun
import { run } from "../src/debug/cli"
run().catch((error) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
