import { EventEmitter } from 'node:events'
import { BASE_SERVER_URL } from '@shared/constants'
import { keepNewestImages, legacyPairs, toolTurn, type Turn, type TurnToolCall } from './conversation'
import { JsonObjectStreamParser } from './streamParser'
import { SupersededResults, toolSpecs } from './toolPayload'
import { joinRound, runToolCalls } from './toolRun'
import { GenerationError, MAX_TOOL_ROUNDS, toHistory, type GenerateInput, type GenerateOptions, type ToolPause } from './types'

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

/** What a cloud pause holds: the conversation so far and the tool calls not yet run. */
interface CloudPauseState {
  turns: Turn[]
  pending: TurnToolCall[]
  system?: string
}

/**
 * Servers that take structured `messages` (with screenshots in tool results)
 * versus only `prompt`. Learned from the first refusal, then kept for the session.
 */
let structuredSupported = true

/** For tests: forget what was learned about the server. */
export function setStructuredSupported(value: boolean): void {
  structuredSupported = value
}

/** A 400 from a server that requires `prompt`: it predates structured messages. */
async function wantsPrompt(res: Response): Promise<boolean> {
  if (res.status !== 400) return false
  try {
    const body = (await res.clone().json()) as { code?: string; issues?: { path?: string }[] } | null
    return body?.code === 'INVALID_BODY' && Boolean(body.issues?.some((i) => i.path === 'prompt'))
  } catch {
    return false
  }
}

/** One event of the backend's stream (Vercel AI SDK fullStream-style), usually wrapped as `{ text: event }`. */
export interface CloudStreamEvent {
  type?: 'text-delta' | 'tool-call' | string
  text?: string
  textDelta?: string
  delta?: string
  toolCallId?: string
  toolName?: string
  /** Gemini 3 signs tool calls here; the signature goes back with the call. */
  providerMetadata?: { google?: { thoughtSignature?: string } }
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
  thoughtSignature?: string
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
  const signature = e.providerMetadata?.google?.thoughtSignature
  return { id: e.toolCallId, name: e.toolName, args, ...(typeof signature === 'string' && signature ? { thoughtSignature: signature } : {}) }
}

/** The request body for one round: structured turns for current servers, the JSON-encoded pairs in `prompt` for older ones. */
export function cloudBody(turns: Turn[], system: string | undefined, structured: boolean): Record<string, unknown> {
  if (structured) return { messages: turns, ...(system ? { system } : {}) }
  const pairs = legacyPairs(turns, system)
  const body: Record<string, unknown> = { prompt: pairs.length === 1 ? String(pairs[0].Value) : JSON.stringify(pairs) }
  // Older servers read images for the newest message only.
  const last = turns[turns.length - 1]
  if (last?.role === 'user' && last.images?.length) body.images = last.images
  return body
}

/**
 * Generates through the LlamaRun backend proxy: `{messages, system, model,
 * Tools?, thinking?}` in, concatenated JSON parts out. Tool calls and their
 * results go as real turns, and a result's screenshot goes with it for vision
 * models. Older servers that only take `prompt` get the conversation as a
 * JSON-encoded list of {Key, Value} pairs, the WinUI app's format.
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
  const turns: Turn[] = resumed ? [...resumed.turns] : toHistory(input, opts.historyChars).map((m) => ({ ...m }))
  const system = resumed ? resumed.system : opts.system
  const bridge = opts.tools
  const maxRounds = opts.maxToolRounds ?? MAX_TOOL_ROUNDS
  const superseded = new SupersededResults()
  const runTools = async (calls: TurnToolCall[]): Promise<void> => {
    if (!bridge) return
    const outcomes = await runToolCalls(bridge, calls, opts)
    outcomes.forEach(({ result, error }, i) => {
      const turn = toolTurn(calls[i], result, error, Boolean(opts.vision))
      if (result) {
        superseded.add(result, (text) => {
          turn.content = text
          delete turn.images
        })
      }
      turns.push(turn)
    })
    keepNewestImages(turns)
  }

  let output = ''
  let url = GENERATE_URL
  if (resumed) await runTools(resumed.pending)
  if (opts.signal?.aborted) return output

  for (let round = 0; ; round++) {
    let structured = structuredSupported
    const bodyFor = (): Record<string, unknown> => {
      const body: Record<string, unknown> = { ...cloudBody(turns, system, structured), model: opts.model }
      if (opts.thinking) body.thinking = opts.thinking
      // Without a way to pause, the last round goes without tools so the model has to answer.
      if (tools?.length && (opts.onPause || round < maxRounds)) body.Tools = tools
      return body
    }

    let res: Response
    try {
      const request = (target: string): Promise<Response> =>
        fetch(target, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.token}` },
          body: JSON.stringify(bodyFor()),
          signal: opts.signal
        })
      res = await request(url)
      if (url === GENERATE_URL && (await isMissingRoute(res))) {
        // An older server without /api/v1: use the legacy route for the rest of this reply.
        url = LEGACY_GENERATE_URL
        structured = structuredSupported = false
        res = await request(url)
      }
      if (structured && (await wantsPrompt(res))) {
        // A server from before structured messages: send prompts from now on.
        structured = structuredSupported = false
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
    let roundText = ''
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
            output = joinRound(output, text, round > 0 && !roundText)
            roundText += text
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
    // What the model said before calling its tools ("Let me open Notepad") stays with the calls.
    const calls = toolCalls.map(withId)
    turns.push({ role: 'assistant', content: roundText, toolCalls: calls })
    if (round >= maxRounds) {
      // The turns end with the calls; continuing runs them and adds their results.
      const state: CloudPauseState = { turns: [...turns], pending: calls, system }
      opts.onPause?.({ backend: 'cloud', model: opts.model, state } satisfies ToolPause)
      return output
    }
    await runTools(calls)
    if (opts.signal?.aborted) return output
  }
}

let callSeq = 0
/** Backends' call ids can be missing or repeat between rounds; a result must name exactly its call. */
function withId(call: CloudToolCall): TurnToolCall {
  return { ...call, id: call.id && call.id.length <= 200 ? call.id : `call_${++callSeq}` }
}
