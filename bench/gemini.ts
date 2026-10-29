/**
 * Llama Run's cloud tool loop (src/main/llm/cloud.ts), talking to the Gemini
 * API directly with a key instead of through the Llama Run server, for
 * benchmarks. Everything else is the app's: the tool specs, the shared tool
 * runner, text-only tool results (cloud models get no screenshots), pruning of
 * superseded window states, the step cap with a last round without tools,
 * and paragraph breaks between rounds.
 */
import { MAX_TOOL_ROUNDS, type GenerateOptions } from '../src/main/llm/types'
import { SupersededResults, toolResultToText, toolSpecs } from '../src/main/llm/toolPayload'
import { joinRound, runToolCalls } from '../src/main/llm/toolRun'

const API = 'https://generativelanguage.googleapis.com/v1beta/models'

interface Part {
  text?: string
  thought?: boolean
  functionCall?: { name: string; args?: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
  [key: string]: unknown
}
interface Content {
  role: 'user' | 'model'
  parts: Part[]
}

export interface GeminiUsage {
  inputTokens: number
  outputTokens: number
  requests: number
}

export async function generateGemini(
  prompt: string,
  opts: GenerateOptions & { apiKey: string },
  usage: GeminiUsage = { inputTokens: 0, outputTokens: 0, requests: 0 }
): Promise<string> {
  const contents: Content[] = [{ role: 'user', parts: [{ text: prompt }] }]
  const declarations = opts.tools ? toolSpecs(opts.tools.tools).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) : []
  const maxRounds = opts.maxToolRounds ?? MAX_TOOL_ROUNDS
  const superseded = new SupersededResults()
  let output = ''

  for (let round = 0; ; round++) {
    const body: Record<string, unknown> = { contents, ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}) }
    // As in the app: the last round goes without tools so the model has to answer.
    if (declarations.length && round < maxRounds) body.tools = [{ functionDeclarations: declarations }]
    const res = await fetchWithRetry(`${API}/${opts.model}:generateContent`, opts.apiKey, body, opts.signal)
    const data = (await res.json()) as {
      candidates?: { content?: Content; finishReason?: string }[]
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
      error?: { message?: string }
    }
    if (!res.ok || data.error) throw new Error(`Gemini ${res.status}: ${data.error?.message ?? 'request failed'}`)
    usage.requests++
    usage.inputTokens += data.usageMetadata?.promptTokenCount ?? 0
    usage.outputTokens += (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0)

    const content = data.candidates?.[0]?.content ?? { role: 'model', parts: [] }
    const text = content.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('')
    if (text) {
      output = joinRound(output, text, round > 0)
      opts.onToken?.(text)
    }
    const calls = content.parts.filter((p) => p.functionCall).map((p) => ({ name: p.functionCall!.name, args: p.functionCall!.args ?? {} }))
    if (!calls.length || !opts.tools) return output
    // The model's turn goes back exactly as sent (Gemini 3 needs its thought signatures returned).
    contents.push({ role: 'model', parts: content.parts })
    const outcomes = await runToolCalls(opts.tools, calls, opts)
    const reply: Content = { role: 'user', parts: [] }
    for (const { call, result, error } of outcomes) {
      const part: Part = { functionResponse: { name: call.name, response: { result: result ? toolResultToText(result) : `Tool error: ${error}` } } }
      if (result) superseded.add(result, (short) => (part.functionResponse!.response = { result: short }))
      reply.parts.push(part)
    }
    contents.push(reply)
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
