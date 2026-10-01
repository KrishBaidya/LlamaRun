import { EventEmitter } from 'node:events'
import { BASE_SERVER_URL } from '@shared/constants'
import { JsonObjectStreamParser } from './streamParser'
import { toolResultToText, toolSpecs } from './toolPayload'
import {
  GenerationError,
  MAX_TOOL_ROUNDS,
  toHistory,
  type GenerateInput,
  type GenerateOptions,
  type ToolPause
} from './types'

type Pair = { Key: string; Value: unknown }

export const GENERATE_URL = `${BASE_SERVER_URL}/api/v1/llm/generate`
/** Servers from before /api/v1. */
export const LEGACY_GENERATE_URL = `${BASE_SERVER_URL}/api/llm/generate`

/**
 * Fires when the server has counted a request against the account's usage
 * (a reply started, or the plan/quota check answered), so the account can be re-read.
 */
export const cloudUsage = new EventEmitter<{ changed: [] }>()

/** A 404 for the route itself (an older server), not a JSON error the new route chose to send. */
async function isMissingRoute(res: Response): Promise<boolean> {
  if (res.status !== 404) return false
  try {
    const body = (await res.clone().json()) as { error?: unknown; code?: unknown } | null
    return !body || (body.error === undefined && body.code === undefined)
  } catch {
    return true
  }
}

/** Turns a non-OK generate response into the error the chat shows. */
export async function responseError(res: Response): Promise<GenerationError> {
  if (res.status === 401 || res.status === 403) {
    return new GenerationError('Not Authenticated. Try Signing In Again!!', 'NOT_AUTHENTICATED')
  }
  const text = await res.text().catch(() => '')
  let detail = text.slice(0, 200)
  let code: string | undefined
  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string; code?: string }
    detail = parsed.error ?? parsed.message ?? detail
    code = parsed.code
  } catch {
    // not JSON
  }
  if (res.status === 402 || code === 'PLAN_REQUIRED') {
    return new GenerationError(detail || 'This model needs LlamaRun Pro.', 'PLAN_REQUIRED')
  }
  if (res.status === 429 || code === 'QUOTA_EXCEEDED') {
    return new GenerationError(detail || 'You have used all of this month’s cloud messages.', 'QUOTA_EXCEEDED')
  }
  return new GenerationError(`LlamaRun server returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`)
}

/** What a cloud pause holds: the conversation pairs and the tool calls not yet run. */
interface CloudPauseState {
  pairs: Pair[]
  pending: CloudToolCall[]
}

/** One event of the backend's stream (Vercel AI SDK fullStream-style), usually wrapped as `{ text: event }`. */
export interface CloudStreamEvent {
  type?: 'text-delta' | 'tool-call' | string
  text?: string
  textDelta?: string
  delta?: string
  toolCallId?: string
  toolName?: string
  /** AI SDK 4 */
  args?: unknown
  /** AI SDK 5+ */
  input?: unknown
  arguments?: unknown
}

export interface CloudStreamPart extends Omit<CloudStreamEvent, 'text'> {
  done?: string | boolean
  text?: CloudStreamEvent | string
  error?: string
}

export interface CloudToolCall {
  id?: string
  name: string
  args: Record<string, unknown>
}

/** The event inside a part: parts are `{ text: {...} }`, but accept a bare event too. */
function eventOf(part: CloudStreamPart): CloudStreamEvent {
  return part.text && typeof part.text === 'object' ? part.text : (part as CloudStreamEvent)
}

/** Text carried by a text-delta event (`text` in AI SDK 5, `textDelta` in 4). */
export function textOf(part: CloudStreamPart): string {
  const e = eventOf(part)
  if (e.type !== 'text-delta') return ''
  const value = e.text ?? e.textDelta ?? e.delta
  return typeof value === 'string' ? value : ''
}

/**
 * The tool call in a tool-call event. Arguments arrive as `args` (AI SDK 4),
 * `input` (AI SDK 5+) or `arguments`, as an object or a JSON string.
 */
export function toolCallOf(part: CloudStreamPart): CloudToolCall | null {
  const e = eventOf(part)
  if (e.type !== 'tool-call' || !e.toolName) return null
  let raw = e.input ?? e.args ?? e.arguments
  if (typeof raw === 'string') {
    try {
      raw = raw.trim() ? JSON.parse(raw) : {}
    } catch {
      raw = {}
    }
  }
  const args = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return { id: e.toolCallId, name: e.toolName, args }
}

/**
 * Generates through the LlamaRun backend proxy. Same wire format as the WinUI
 * app's CloudLLMService: `{prompt, model, Tools?}` in, concatenated JSON parts out.
 * Conversations (and tool-call follow-ups) are sent as a JSON-encoded list of
 * {Key: role, Value: content} pairs in `prompt`, the format the original client
 * used after tool calls. A single-turn prompt is sent as plain text.
 */
export async function generateCloud(
  input: GenerateInput,
  opts: GenerateOptions & { token: string }
): Promise<string> {
  if (!opts.token) {
    throw new GenerationError('Not Authenticated. Try Signing In Again!!', 'NOT_AUTHENTICATED')
  }

  const tools = opts.tools ? toolSpecs(opts.tools.tools) : undefined

  const resumed = opts.resume?.backend === 'cloud' ? (opts.resume.state as CloudPauseState) : undefined
  const pairs: Pair[] = resumed ? [...resumed.pairs] : toHistory(input).map((m) => ({ Key: m.role, Value: m.content }))
  // The backend takes no system prompt, so instructions lead the newest user message.
  if (!resumed && opts.system && pairs.length) {
    const last = pairs[pairs.length - 1]
    pairs[pairs.length - 1] = { ...last, Value: `${opts.system}

${String(last.Value)}` }
  }
  const bridge = opts.tools
  const runTools = async (calls: CloudToolCall[]): Promise<void> => {
    if (!bridge) return
    for (const call of calls) {
      opts.onTool?.(call.name, bridge.tools.find((t) => t.name === call.name)?.server ?? '')
      let text: string
      try {
        text = toolResultToText(await bridge.call(call.name, call.args))
      } catch (err) {
        text = `Tool error: ${(err as Error).message}`
      }
      pairs.push(
        { Key: 'assistant', Value: JSON.stringify({ type: 'tool-call', toolCallId: call.id, toolName: call.name, args: call.args }) },
        { Key: 'user', Value: { content: [{ type: 'text', text }] } }
      )
    }
  }

  let output = ''
  let url = GENERATE_URL
  if (resumed) await runTools(resumed.pending)
  if (opts.signal?.aborted) return output

  for (let round = 0; ; round++) {
    const prompt = pairs.length === 1 ? String(pairs[0].Value) : JSON.stringify(pairs)
    const body: Record<string, unknown> = { prompt, model: opts.model }
    // Without a way to pause, the last round goes without tools so the model has to answer.
    if (tools?.length && (opts.onPause || round < MAX_TOOL_ROUNDS)) body.Tools = tools

    let res: Response
    try {
      const request = (target: string): Promise<Response> =>
        fetch(target, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.token}` },
          body: JSON.stringify(body),
          signal: opts.signal
        })
      res = await request(url)
      if (url === GENERATE_URL && (await isMissingRoute(res))) {
        // An older server without /api/v1: use the legacy route for the rest of this reply.
        url = LEGACY_GENERATE_URL
        res = await request(url)
      }
    } catch (err) {
      if (opts.signal?.aborted) return output
      throw new GenerationError(`Could not reach LlamaRun server: ${(err as Error).message}`)
    }
    if (!res.ok || !res.body) {
      const error = await responseError(res)
      if (error.code === 'PLAN_REQUIRED' || error.code === 'QUOTA_EXCEEDED') cloudUsage.emit('changed')
      throw error
    }
    cloudUsage.emit('changed')

    // A model can ask for several tools in one step; run them all.
    const toolCalls: CloudToolCall[] = []
    const parser = new JsonObjectStreamParser()
    const decoder = new TextDecoder()
    const reader = res.body.getReader()
    try {
      outer: for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        for (const part of parser.push(decoder.decode(value, { stream: true })) as CloudStreamPart[]) {
          if (part.error) throw new GenerationError(part.error)
          if (part.done !== undefined && String(part.done).toLowerCase() === 'true') break outer
          const text = textOf(part)
          if (text) {
            output += text
            opts.onToken?.(text)
            continue
          }
          const call = toolCallOf(part)
          if (call) toolCalls.push(call)
        }
      }
    } catch (err) {
      if (opts.signal?.aborted) return output
      throw err
    } finally {
      reader.releaseLock()
    }

    if (!toolCalls.length || !bridge) return output
    if (round >= MAX_TOOL_ROUNDS) {
      const state: CloudPauseState = { pairs: [...pairs], pending: toolCalls }
      opts.onPause?.({ backend: 'cloud', model: opts.model, state } satisfies ToolPause)
      return output
    }
    await runTools(toolCalls)
    if (opts.signal?.aborted) return output
  }
}
