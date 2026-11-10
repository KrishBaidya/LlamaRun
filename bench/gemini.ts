/**
 * Llama Run's cloud tool loop (src/main/llm/cloud.ts), talking to the Gemini
 * API directly with a key instead of through the Llama Run server, for
 * benchmarks. Everything else is the app's: the tool specs, the shared tool
 * runner, tool results as real turns with the newest screenshot inside the
 * function response (as the server sends them), pruning of superseded window
 * states, low thinking for computer-use steps, the step
 * cap with a last round without tools, and paragraph breaks between rounds.
 */
import { keepNewestImages, toolTurn, type Turn } from '../src/main/llm/conversation'
import { MAX_TOOL_ROUNDS, type GenerateOptions } from '../src/main/llm/types'
import { SupersededResults, toolSpecs } from '../src/main/llm/toolPayload'
import { joinRound, runToolCalls } from '../src/main/llm/toolRun'

const API = 'https://generativelanguage.googleapis.com/v1beta/models'

interface Part {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  functionCall?: { name: string; args?: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown>; parts?: { inlineData: { mimeType: string; data: string } }[] }
  [key: string]: unknown
}
interface Content {
  role: 'user' | 'model'
  parts: Part[]
}

export interface GeminiUsage {
  inputTokens: number
  /** Of inputTokens, how many Gemini read from its cache (billed at the cached rate). */
  cachedTokens: number
  outputTokens: number
  /** Of outputTokens, how many were thinking. */
  thinkingTokens: number
  requests: number
}

/**
 * The turns as Gemini contents. The model's own turns go back exactly as
 * Gemini sent them (`raw`): Gemini 3 needs its thought signatures returned.
 */
export function geminiContents(turns: Turn[], raw: Map<Turn, Part[]>): Content[] {
  const contents: Content[] = []
  for (const turn of turns) {
    if (turn.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: turn.content }, ...(turn.images ?? []).map((i) => ({ inlineData: { mimeType: i.mediaType, data: i.data } }))] })
    } else if (turn.role === 'assistant') {
      contents.push({ role: 'model', parts: raw.get(turn) ?? [{ text: turn.content }] })
    } else {
      const part: Part = {
        functionResponse: {
          name: turn.toolName,
          response: { result: turn.content },
          ...(turn.images?.length ? { parts: turn.images.map((i) => ({ inlineData: { mimeType: i.mediaType, data: i.data } })) } : {})
        }
      }
      const last = contents[contents.length - 1]
      // Results of one step's calls go together in one turn.
      if (last?.role === 'user' && last.parts.every((p) => p.functionResponse)) last.parts.push(part)
      else contents.push({ role: 'user', parts: [part] })
    }
  }
  return contents
}

export async function generateGemini(
  prompt: string,
  opts: GenerateOptions & { apiKey: string },
  usage: GeminiUsage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, thinkingTokens: 0, requests: 0 }
): Promise<string> {
  const turns: Turn[] = [{ role: 'user', content: prompt }]
  const raw = new Map<Turn, Part[]>()
  const declarations = opts.tools ? toolSpecs(opts.tools.tools).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) : []
  const maxRounds = opts.maxToolRounds ?? MAX_TOOL_ROUNDS
  const superseded = new SupersededResults()
  let output = ''
  let seq = 0

  for (let round = 0; ; round++) {
    const body: Record<string, unknown> = {
      contents: geminiContents(turns, raw),
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      ...(opts.thinking ? { generationConfig: { thinkingConfig: { thinkingLevel: opts.thinking === 'minimal' ? 'low' : opts.thinking } } } : {})
    }
    // As in the app: the last round goes without tools so the model has to answer.
    if (declarations.length && round < maxRounds) body.tools = [{ functionDeclarations: declarations }]
    const res = await fetchWithRetry(`${API}/${opts.model}:generateContent`, opts.apiKey, body, opts.signal)
    const data = (await res.json()) as {
      candidates?: { content?: Content; finishReason?: string }[]
      usageMetadata?: { promptTokenCount?: number; cachedContentTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
      error?: { message?: string }
    }
    if (!res.ok || data.error) throw new Error(`Gemini ${res.status}: ${data.error?.message ?? 'request failed'}`)
    usage.requests++
    usage.inputTokens += data.usageMetadata?.promptTokenCount ?? 0
    usage.cachedTokens += data.usageMetadata?.cachedContentTokenCount ?? 0
    usage.thinkingTokens += data.usageMetadata?.thoughtsTokenCount ?? 0
    usage.outputTokens += (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0)

    const content = data.candidates?.[0]?.content ?? { role: 'model', parts: [] }
    const text = content.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('')
    if (text) {
      output = joinRound(output, text, round > 0)
      opts.onToken?.(text)
    }
    const calls = content.parts.filter((p) => p.functionCall).map((p) => ({ id: `call_${++seq}`, name: p.functionCall!.name, args: { ...(p.functionCall!.args ?? {}) } }))
    if (!calls.length || !opts.tools) return output
    // The app pauses here for the user to continue (cloud.ts); with nobody to ask, the run ends.
    // Gemini can still call tools in the last round even though none were sent.
    if (round >= maxRounds) return output
    const turn: Turn = { role: 'assistant', content: text, toolCalls: calls }
    raw.set(turn, content.parts)
    turns.push(turn)
    const outcomes = await runToolCalls(opts.tools, calls, opts)
    outcomes.forEach(({ result, error }, i) => {
      const reply = toolTurn(calls[i], result, error, Boolean(opts.vision))
      if (result) {
        superseded.add(result, (short) => {
          reply.content = short
          delete reply.images
        })
      }
      turns.push(reply)
    })
    keepNewestImages(turns)
    if (opts.signal?.aborted) return output
  }
}

/** Rate limits and overloads are common on preview models: back off and retry a few times. */
async function fetchWithRetry(url: string, key: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal
    })
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await new Promise((done) => setTimeout(done, 2000 * 2 ** attempt))
      continue
    }
    return res
  }
}
