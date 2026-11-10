import type { McpToolResult } from '../mcp/manager'
import { toolResultImages, toolResultToText } from './toolPayload'
import type { HistoryImage } from './types'

/**
 * A tool-using conversation as structured turns, the shape the LlamaRun
 * server's `messages` takes: tool calls and results are real turns, results
 * can carry a screenshot, and nothing is JSON-escaped inside a prompt.
 */
export type Turn =
  | { role: 'user'; content: string; images?: HistoryImage[] }
  | { role: 'assistant'; content: string; toolCalls?: TurnToolCall[] }
  | { role: 'tool'; toolCallId: string; toolName: string; content: string; isError?: boolean; images?: HistoryImage[] }

export interface TurnToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  /** Gemini 3's signature for the call; it must come back with it on later requests. */
  thoughtSignature?: string
}

/** Most screenshots kept in a conversation: older ones are dropped, the newest is what the model needs. */
export const MAX_TURN_IMAGES = 1

/**
 * The tool result as a turn. Images go along only for models that can see
 * them, and only `MAX_TURN_IMAGES` of them: each screenshot costs about a
 * thousand tokens on every later request.
 */
export function toolTurn(call: TurnToolCall, result: McpToolResult | null, error: string | undefined, vision: boolean): Extract<Turn, { role: 'tool' }> {
  if (!result) return { role: 'tool', toolCallId: call.id, toolName: call.name, content: `Tool error: ${error}`, isError: true }
  const images = vision ? toolResultImages(result).slice(0, MAX_TURN_IMAGES) : []
  return {
    role: 'tool',
    toolCallId: call.id,
    toolName: call.name,
    content: toolResultToText(result),
    ...(result.isError ? { isError: true } : {}),
    ...(images.length ? { images: images.map((data) => ({ data, mediaType: mediaTypeOf(result, data) })) } : {})
  }
}

function mediaTypeOf(result: McpToolResult, data: string): string {
  const item = result.content.find((c) => (c as { data?: string }).data === data) as { mimeType?: string } | undefined
  return item?.mimeType ?? 'image/png'
}

/** Keeps only the newest screenshots across the conversation. */
export function keepNewestImages(turns: Turn[], max = MAX_TURN_IMAGES): void {
  let kept = 0
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]
    if (turn.role !== 'tool' || !turn.images?.length) continue
    if (kept >= max) delete turn.images
    else kept += turn.images.length
  }
}

// The model's own earlier tool calls go back exactly as it made them. Cutting
// long arguments to "[N characters]" saved tokens, but models copy what they
// see themselves doing: Gemini then sent `[844 characters]` as Blender code.

/**
 * The same conversation in the legacy wire format (older servers): a list of
 * {Key: role, Value: content} pairs that goes JSON-encoded in `prompt`, with
 * the system prompt leading the newest user message. Screenshots can't go.
 */
export function legacyPairs(turns: Turn[], system?: string): { Key: string; Value: unknown }[] {
  const pairs: { Key: string; Value: unknown }[] = []
  let lastUser = -1
  for (const turn of turns) {
    if (turn.role === 'user') {
      lastUser = pairs.length
      pairs.push({ Key: 'user', Value: turn.content })
    } else if (turn.role === 'assistant') {
      if (turn.content.trim()) pairs.push({ Key: 'assistant', Value: turn.content })
      for (const call of turn.toolCalls ?? []) {
        pairs.push({ Key: 'assistant', Value: JSON.stringify({ type: 'tool-call', toolCallId: call.id, toolName: call.name, args: call.args }) })
      }
    } else {
      pairs.push({ Key: 'user', Value: { content: [{ type: 'text', text: turn.content }] } })
    }
  }
  if (system && lastUser >= 0) pairs[lastUser] = { Key: 'user', Value: `${system}\n\n${String(pairs[lastUser].Value)}` }
  return pairs
}
