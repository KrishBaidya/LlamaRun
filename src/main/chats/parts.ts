import type { ChatMessage, MessagePart, ToolPart } from '@shared/types'
import type { McpToolResult } from '../mcp/manager'
import { toolResultToText } from '../llm/toolPayload'

/**
 * An assistant reply as it happened: the text the model wrote between tool
 * calls, and each call with its arguments and result, in order (like
 * Claude Code's transcript). The chat window draws these in place.
 */

/** Longest tool result kept with a chat; the model saw the full one at the time. */
const MAX_STORED_RESULT = 12_000
/** Longest single argument value kept (typed text, code). */
const MAX_STORED_ARG = 1000
/** How much of an older reply's tool results later turns see. */
const MAX_RECALLED_RESULT = 2000
/** The newest replies with tool calls, whose results later turns see in full (as stored). */
const RECALL_FULL = 2

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…[${text.length - max} more characters]`
}

function trimArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) out[key] = typeof value === 'string' ? cut(value, MAX_STORED_ARG) : value
  return out
}

/** Adds streamed thinking: onto the last thinking part, or as a new one. */
export function appendThinking(parts: MessagePart[], text: string): void {
  const last = parts[parts.length - 1]
  if (last?.type === 'thinking') last.text += text
  else parts.push({ type: 'thinking', text })
}

/** Adds streamed text: onto the last text part, or as a new one after a tool call. */
export function appendText(parts: MessagePart[], text: string): void {
  const last = parts[parts.length - 1]
  if (last?.type === 'text') last.text += text
  else parts.push({ type: 'text', text })
}

export function toolPart(id: string, name: string, server: string, args: Record<string, unknown>): ToolPart {
  return { type: 'tool', id, name, server, args: trimArgs(args), status: 'running' }
}

/** Records how a call ended: its result as text (images left out), or the error it threw. */
export function finishTool(part: ToolPart, result: McpToolResult | null, error?: string): void {
  part.status = !result || result.isError ? 'error' : 'done'
  part.result = cut(result ? toolResultToText(result, MAX_STORED_RESULT * 2) : `Tool error: ${error ?? 'failed'}`, MAX_STORED_RESULT)
  if (result?.steps?.length) part.steps = result.steps.slice(0, 200)
  if (result?.app) part.app = result.app
}

/** The reply's text, rounds separated by a blank line: what `content` holds. */
export function textOf(parts: MessagePart[]): string {
  return parts
    .filter((p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join('\n\n')
}

/** A plugin's after-hook rewrote the reply: its text replaces the model's, after the tool calls. */
export function replaceText(parts: MessagePart[], text: string): MessagePart[] {
  return [...parts.filter((p) => p.type !== 'text'), ...(text ? [{ type: 'text' as const, text }] : [])]
}

/**
 * What the model reads for one of its earlier replies: its text and each tool
 * call with what came back, so data it fetched (a portfolio, a file) is still
 * there in later turns. `recall` is how much of each result to keep (true:
 * all that was stored; false: text only).
 */
export function replyForModel(message: ChatMessage, recall: number | boolean): string {
  if (recall === false || !message.parts?.some((p) => p.type === 'tool')) return message.content
  const limit = recall === true ? MAX_STORED_RESULT : recall
  return message.parts
    .map((p) => {
      if (p.type === 'text') return p.text.trim()
      if (p.type === 'thinking') return ''
      if (p.type === 'steer') return `[the user added while you worked: ${p.text}]`
      const args = p.args && Object.keys(p.args).length ? ` ${JSON.stringify(p.args)}` : ''
      const outcome = p.result ? `: ${cut(p.result.trim(), limit)}` : ''
      return `[earlier tool call ${p.name}${args}${p.status === 'error' ? ' failed' : ''}${outcome}]`
    })
    .filter(Boolean)
    .join('\n')
}

/** How much of each reply's tool results later turns see: the newest few in full, older ones shortened. */
export function recallLimits(messages: ChatMessage[]): Map<string, number> {
  const withTools = messages.filter((m) => m.role === 'assistant' && m.parts?.some((p) => p.type === 'tool'))
  return new Map(withTools.map((m, i) => [m.id, i >= withTools.length - RECALL_FULL ? MAX_STORED_RESULT : MAX_RECALLED_RESULT]))
}
