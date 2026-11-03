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

/**
 * The driver asking its host (Llama Run) to approve a residual boundary, such
 * as attaching to the user's signed-in browser profile. Only the parts the
 * user is shown: the request's attested resource stays in the worker.
 */
export interface AuthorizationAsk {
  id: number
  /** The Cua session that asked: which chat the approval card belongs to. */
  session: string
  /** The driver's own description of what it would do. */
  summary: string
  riskClass: string
  /** When the driver stops waiting for an answer (Unix ms). */
  expiresAt: number
}

export type WorkerRequest =
  | { id: number; tool: string; args: Record<string, unknown> }
  | { id: number; shutdown: true }
  | { authorized: number; allow: boolean }

export type WorkerResponse =
  | { id: number; result: DriverResult }
  | { id: number; error: string }
  | { ready: true }
  | { fatal: string }
  | { authorize: AuthorizationAsk }
  /** The driver stopped waiting (the request expired or was cancelled): take the question down. */
  | { withdraw: number }

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
/** How far an interrupted action got (DriverError.ActionInterrupted's `completion`), by its enum value. */
const COMPLETION = ['did not start', 'completed', 'may or may not have happened']

/**
 * A thrown driver error as text. An interrupted action says whether it reached
 * the app, so nothing that already happened is replayed blindly.
 */
export function errorText(err: unknown): string {
  const e = err as { tag?: string; message?: string; inner?: { completion?: number; reason?: string } }
  if (e?.tag === 'ActionInterrupted' && e.inner) {
    const how = COMPLETION[e.inner.completion ?? 2] ?? COMPLETION[2]
    return `The action was interrupted and ${how}${e.inner.reason ? ` (${e.inner.reason})` : ''}. Check the window before trying it again.`
  }
  return e?.message ?? String(err)
}

export function sdkSpecifier(dir: string): string {
  const unpacked = dir.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked')
  if (unpacked === dir) return '@trycua/cua-driver'
  return pathToFileURL(join(unpacked, '..', '..', 'node_modules', '@trycua', 'cua-driver', 'dist', 'index.js')).href
}
