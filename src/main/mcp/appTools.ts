import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type { McpToolInfo } from '@shared/types'
import { approvals } from '../assistant/approval'
import type { McpToolResult } from './manager'

/**
 * Tools an open MCP App offers (its appCapabilities.tools), so the model can
 * act in the app the user is looking at, like Claude editing a Confluence page
 * the user has open. The app lives in the chat window: a call goes there, the
 * window asks the app, and the answer comes back. Calls that may change
 * something ask the user first, like any action on their behalf.
 */

export interface AppToolDef {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean; title?: string }
}

interface View {
  chatId: string
  server: string
  tools: AppToolDef[]
  sender: WebContents
}

const CALL_TIMEOUT_MS = 120_000
const views = new Map<string, View>()
const waiting = new Map<string, { resolve: (r: McpToolResult) => void; timer: NodeJS.Timeout }>()
/** chatId:server pairs the user allowed for the rest of the chat. */
const allowedForChat = new Set<string>()

/** The model's name for an app's tool: app_<server>_<tool>, letters, digits, _ and - only, at most 64. */
export function appToolName(server: string, tool: string): string {
  const clean = (s: string): string => s.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
  return `app_${clean(server).toLowerCase()}_${clean(tool)}`.slice(0, 64)
}

/** The newest open view of each server in a chat wins its tool names. */
function byName(chatId: string): Map<string, { viewId: string; view: View; tool: AppToolDef }> {
  const out = new Map<string, { viewId: string; view: View; tool: AppToolDef }>()
  for (const [viewId, view] of views) {
    if (view.chatId !== chatId || view.sender.isDestroyed()) continue
    for (const tool of view.tools) out.set(appToolName(view.server, tool.name), { viewId, view, tool })
  }
  return out
}

export const appTools = {
  /** An app finished loading (or its tools changed) and offers these tools. */
  register(sender: WebContents, chatId: string, viewId: string, server: string, tools: unknown): void {
    const list = (Array.isArray(tools) ? tools : [])
      .filter((t): t is AppToolDef => !!t && typeof t === 'object' && typeof (t as AppToolDef).name === 'string')
      .slice(0, 50)
    views.delete(viewId)
    if (list.length) views.set(viewId, { chatId, server, tools: list, sender })
  },

  unregister(viewId: string): void {
    views.delete(viewId)
  },

  /** The open apps' tools for a chat's turn. */
  toolsFor(chatId: string | undefined): McpToolInfo[] {
    if (!chatId) return []
    return [...byName(chatId)].map(([name, { view, tool }]) => ({
      name,
      server: view.server,
      description: `In the ${view.server} app open in this chat: ${tool.description ?? tool.annotations?.title ?? tool.name}`,
      inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : { type: 'object' }
    }))
  },

  has(chatId: string | undefined, name: string): boolean {
    return Boolean(chatId) && byName(chatId!).has(name)
  },

  /** Runs one of an open app's tools; asks the user first unless the app marks it read-only. */
  async call(chatId: string, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolResult> {
    const found = byName(chatId).get(name)
    if (!found) return { content: [{ type: 'text', text: `${name} isn't available: its app is no longer open.` }], isError: true }
    const { viewId, view, tool } = found
    if (tool.annotations?.readOnlyHint !== true && !allowedForChat.has(`${chatId}:${view.server}`)) {
      const answer = await approvals.ask(
        chatId,
        {
          title: `Let the model use the ${view.server} app?`,
          command: `${tool.annotations?.title ?? tool.name} ${JSON.stringify(args)}`.slice(0, 2000),
          detail: `In the ${view.server} app open in this chat.`,
          alwaysLabel: '',
          chatLabel: `Allow ${view.server} app actions for this chat`
        },
        signal
      )
      if (answer === 'deny') return { content: [{ type: 'text', text: `The user didn't allow ${tool.name} in the ${view.server} app.` }], isError: true }
      if (answer === 'chat') allowedForChat.add(`${chatId}:${view.server}`)
    }
    if (view.sender.isDestroyed()) return { content: [{ type: 'text', text: 'The app was closed.' }], isError: true }
    const requestId = randomUUID()
    return new Promise<McpToolResult>((resolve) => {
      const timer = setTimeout(() => {
        waiting.delete(requestId)
        resolve({ content: [{ type: 'text', text: `The ${view.server} app didn't answer.` }], isError: true })
      }, CALL_TIMEOUT_MS)
      waiting.set(requestId, { resolve, timer })
      view.sender.send('mcpApps:callAppTool', { requestId, viewId, name: tool.name, args })
    })
  },

  /** The chat window's answer for a call. */
  answer(requestId: string, result: unknown): void {
    const entry = waiting.get(requestId)
    if (!entry) return
    waiting.delete(requestId)
    clearTimeout(entry.timer)
    const r = (result && typeof result === 'object' ? result : {}) as { content?: unknown; isError?: unknown; error?: unknown }
    if (typeof r.error === 'string') return entry.resolve({ content: [{ type: 'text', text: `The app failed: ${r.error}` }], isError: true })
    entry.resolve({ content: Array.isArray(r.content) ? r.content : [{ type: 'text', text: JSON.stringify(result ?? null) }], isError: r.isError === true })
  }
}
