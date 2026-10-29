import type { GenerationErrorCode, McpToolInfo } from '@shared/types'
import type { McpToolResult } from '../mcp/manager'

export { toolResultToText } from './toolPayload'

export class GenerationError extends Error {
  constructor(
    message: string,
    readonly code: GenerationErrorCode = 'UNKNOWN'
  ) {
    super(message)
  }
}

export interface ToolBridge {
  tools: McpToolInfo[]
  call(name: string, args: Record<string, unknown>): Promise<McpToolResult>
}

/** One prior turn of a conversation, oldest first. The last entry is the new user message. */
export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
  /** User turns: attached images, for vision models. */
  images?: HistoryImage[]
}

export interface HistoryImage {
  /** Base64, without a data: prefix. */
  data: string
  mediaType: string
}

export type GenerateInput = string | HistoryMessage[]

/**
 * Roughly 15k tokens of earlier conversation: the cut for callers that don't
 * size history to the model (plugins' llm.generate). Chats size it from the
 * model's context window and compact before it fills (see chats/compact.ts),
 * so for them this cut is only a last safety net.
 */
export const MAX_HISTORY_CHARS = 60_000

export function toHistory(input: GenerateInput, budget = MAX_HISTORY_CHARS): HistoryMessage[] {
  if (typeof input === 'string') return [{ role: 'user', content: input }]
  // Keep the newest turns that fit; the latest message always goes.
  let used = 0
  let start = input.length
  while (start > 0) {
    const size = input[start - 1].content.length
    if (start < input.length && used + size > budget) break
    used += size
    start--
  }
  // Start on a user turn so the model never sees a reply without its question.
  while (start < input.length - 1 && input[start].role !== 'user') start++
  return input.slice(start)
}

export interface GenerateOptions {
  model: string
  signal?: AbortSignal
  onToken?: (text: string) => void
  onTool?: (name: string, server: string) => void
  /** MCP tools the model may call. Omit for a plain text completion. */
  tools?: ToolBridge
  /**
   * Called when the model still wants tools after MAX_TOOL_ROUNDS. Without it,
   * the last round is sent with no tools so the model has to answer.
   */
  onPause?: (pause: ToolPause) => void
  /**
   * Extra instructions for this generation only (e.g. "replies are read aloud").
   * Not part of the chat history.
   */
  system?: string
  /** Carries on from a pause: runs the tool calls it was holding, then continues. `input` is ignored. */
  resume?: ToolPause
  /** Most characters of history to send (defaults to MAX_HISTORY_CHARS). */
  historyChars?: number
  /** Ollama: context window for this request (`num_ctx`), from the model's own size or the user's override. */
  contextTokens?: number
  /** Ollama: token counts for each request of the turn (one per tool round), as Ollama reports them. */
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void
}

/** Maximum model -> tool -> model round trips before pausing (or forcing an answer). */
export const MAX_TOOL_ROUNDS = 8

/**
 * Where a generation stopped at the tool-round cap: the whole conversation so
 * far, including tool results, plus the calls the model asked for next.
 * Continuing from it costs one request, not a rebuild of the context.
 */
export interface ToolPause {
  backend: 'cloud' | 'ollama'
  model: string
  state: unknown
}
