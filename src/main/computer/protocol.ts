import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Messages between the main process and the Cua Driver worker
 * (computer/worker.ts). Plain JSON, so they cross a utility-process port.
 */

/** One Cua Driver tool result, reduced to what Llama Run uses. */
export interface DriverResult {
  text: string
  images: { mimeType: string; data: string }[]
  /** The tool's structured output (parsed `structuredJson`), when it has one. */
  structured?: Record<string, unknown>
  isError: boolean
  errorCode?: string
}

export type WorkerRequest = { id: number; tool: string; args: Record<string, unknown> } | { id: number; shutdown: true }

export type WorkerResponse = { id: number; result: DriverResult } | { id: number; error: string } | { ready: true } | { fatal: string }

/** The SDK's ToolResult, typed loosely so this file doesn't import the native package. */
interface NativeToolResult {
  text: string
  images: { mimeType: string; dataBase64: string }[]
  structuredJson?: string
  isError: boolean
  errorCode?: string
}

export function toDriverResult(r: NativeToolResult): DriverResult {
  let structured: Record<string, unknown> | undefined
  if (r.structuredJson) {
    try {
      structured = JSON.parse(r.structuredJson) as Record<string, unknown>
    } catch {
      structured = undefined
    }
  }
  return {
    text: r.text ?? '',
    images: (r.images ?? []).map((i) => ({ mimeType: i.mimeType, data: i.dataBase64 })),
    structured,
    isError: Boolean(r.isError),
    errorCode: r.errorCode
  }
}

/**
 * Where to load the SDK from. It finds its native library next to its own
 * files, and Windows can't load a DLL from inside app.asar, so the installed
 * app loads it from app.asar.unpacked (see asarUnpack in electron-builder.yml).
 */
export function sdkSpecifier(dir: string): string {
  const unpacked = dir.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked')
  if (unpacked === dir) return '@trycua/cua-driver'
  return pathToFileURL(join(unpacked, '..', '..', 'node_modules', '@trycua', 'cua-driver', 'dist', 'index.js')).href
}
