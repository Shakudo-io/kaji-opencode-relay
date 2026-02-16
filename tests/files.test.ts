import { describe, expect, test } from "bun:test"
import { createFilePartInput, createFilePartInputFromBuffer, detectMimeType, filePartDataSize } from "../src/files"
import { writeFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"

const TMP_DIR = "/tmp/relay-file-tests"

function setup() {
  mkdirSync(TMP_DIR, { recursive: true })
}

function cleanup() {
  try { rmSync(TMP_DIR, { recursive: true }) } catch {}
}

describe("detectMimeType", () => {
  test("detects image types", () => {
    expect(detectMimeType("photo.png")).toBe("image/png")
    expect(detectMimeType("photo.jpg")).toBe("image/jpeg")
    expect(detectMimeType("photo.gif")).toBe("image/gif")
    expect(detectMimeType("photo.webp")).toBe("image/webp")
    expect(detectMimeType("icon.svg")).toBe("image/svg+xml")
  })

  test("detects text/code types", () => {
    expect(detectMimeType("readme.md")).toBe("text/markdown")
    expect(detectMimeType("config.json")).toBe("application/json")
    expect(detectMimeType("app.ts")).toBe("application/typescript")
    expect(detectMimeType("script.py")).toBe("text/x-python")
  })

  test("returns octet-stream for unknown", () => {
    expect(detectMimeType("data.xyz")).toBe("application/octet-stream")
  })
})

describe("createFilePartInput", () => {
  test("reads file and returns FilePartInput with data URI", async () => {
    setup()
    const filePath = join(TMP_DIR, "test.txt")
    writeFileSync(filePath, "hello world")

    const result = await createFilePartInput(filePath)

    expect(result.type).toBe("file")
    expect(result.mime).toBe("text/plain")
    expect(result.filename).toBe("test.txt")
    expect(result.url.startsWith("data:text/plain;base64,")).toBe(true)

    const decoded = Buffer.from(result.url.split(",")[1]!, "base64").toString()
    expect(decoded).toBe("hello world")
    cleanup()
  })

  test("reads image file correctly", async () => {
    setup()
    const filePath = join(TMP_DIR, "pixel.png")
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    writeFileSync(filePath, pngHeader)

    const result = await createFilePartInput(filePath)

    expect(result.mime).toBe("image/png")
    expect(result.url.startsWith("data:image/png;base64,")).toBe(true)
    cleanup()
  })

  test("throws on file exceeding size limit", async () => {
    setup()
    const filePath = join(TMP_DIR, "big.bin")
    writeFileSync(filePath, Buffer.alloc(1024))

    await expect(createFilePartInput(filePath, { maxSizeBytes: 512 })).rejects.toThrow("exceeds maximum size")
    cleanup()
  })

  test("allows custom filename", async () => {
    setup()
    const filePath = join(TMP_DIR, "temp.dat")
    writeFileSync(filePath, "data")

    const result = await createFilePartInput(filePath, { filename: "report.txt" })
    expect(result.filename).toBe("report.txt")
    cleanup()
  })
})

describe("createFilePartInputFromBuffer", () => {
  test("creates FilePartInput from Buffer", () => {
    const buf = Buffer.from("hello buffer")
    const result = createFilePartInputFromBuffer(buf, "test.txt", "text/plain")

    expect(result.type).toBe("file")
    expect(result.mime).toBe("text/plain")
    expect(result.filename).toBe("test.txt")
    expect(result.url.startsWith("data:text/plain;base64,")).toBe(true)

    const decoded = Buffer.from(result.url.split(",")[1]!, "base64").toString()
    expect(decoded).toBe("hello buffer")
  })

  test("creates FilePartInput from Uint8Array", () => {
    const arr = new Uint8Array([72, 101, 108, 108, 111])
    const result = createFilePartInputFromBuffer(arr, "greeting.bin", "application/octet-stream")

    expect(result.filename).toBe("greeting.bin")
    const decoded = Buffer.from(result.url.split(",")[1]!, "base64").toString()
    expect(decoded).toBe("Hello")
  })
})

describe("filePartDataSize", () => {
  test("calculates decoded size from data URI", () => {
    const buf = Buffer.from("test content here")
    const base64 = buf.toString("base64")
    const url = `data:text/plain;base64,${base64}`

    const size = filePartDataSize(url)
    expect(size).toBeGreaterThanOrEqual(buf.length - 2)
    expect(size).toBeLessThanOrEqual(buf.length + 2)
  })

  test("returns 0 for non-data URIs", () => {
    expect(filePartDataSize("https://example.com/file.png")).toBe(0)
  })
})
