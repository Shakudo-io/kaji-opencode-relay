import { readFile, stat } from "fs/promises"
import { basename, extname } from "path"

export interface FilePartInput {
  id?: string
  type: "file"
  mime: string
  filename?: string
  url: string
}

export interface CreateFilePartOptions {
  maxSizeBytes?: number
  filename?: string
}

const DEFAULT_MAX_SIZE = 20 * 1024 * 1024

const MIME_TYPES: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".js": "application/javascript",
  ".ts": "application/typescript",
  ".py": "text/x-python",
  ".html": "text/html",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".csv": "text/csv",
  ".xml": "application/xml",
  ".yaml": "application/x-yaml",
  ".yml": "application/x-yaml",
  ".sh": "application/x-sh",
  ".rb": "text/x-ruby",
  ".go": "text/x-go",
  ".rs": "text/x-rust",
  ".java": "text/x-java",
  ".c": "text/x-c",
  ".cpp": "text/x-c++",
  ".h": "text/x-c",
  ".toml": "application/toml",
}

export function detectMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  return MIME_TYPES[ext] ?? "application/octet-stream"
}

export async function createFilePartInput(
  filePath: string,
  options?: CreateFilePartOptions,
): Promise<FilePartInput> {
  const maxSize = options?.maxSizeBytes ?? DEFAULT_MAX_SIZE
  const fileStats = await stat(filePath)

  if (fileStats.size > maxSize) {
    throw new Error(
      `File exceeds maximum size: ${(fileStats.size / 1024 / 1024).toFixed(2)}MB > ${(maxSize / 1024 / 1024).toFixed(2)}MB limit`,
    )
  }

  const buffer = await readFile(filePath)
  const mime = detectMimeType(filePath)
  const filename = options?.filename ?? basename(filePath)
  const base64 = buffer.toString("base64")

  return {
    type: "file",
    mime,
    filename,
    url: `data:${mime};base64,${base64}`,
  }
}

export function createFilePartInputFromBuffer(
  buffer: Buffer | Uint8Array,
  filename: string,
  mime: string,
): FilePartInput {
  const buf = buffer instanceof Buffer ? buffer : Buffer.from(buffer)
  const base64 = buf.toString("base64")

  return {
    type: "file",
    mime,
    filename,
    url: `data:${mime};base64,${base64}`,
  }
}

export function filePartDataSize(url: string): number {
  const prefix = url.indexOf(";base64,")
  if (prefix === -1) return 0
  const base64 = url.slice(prefix + 8)
  return Math.floor((base64.length * 3) / 4)
}
