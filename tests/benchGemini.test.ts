import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateGemini } from '../bench/gemini'

const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 })
const call = (name: string, args: Record<string, unknown>, extra = {}) => ({ functionCall: { name, args }, ...extra })
const tools = {
  tools: [{ name: 'computer_look', server: 'Computer use', description: 'Read a window.', inputSchema: { type: 'object', title: 'x', properties: { window: { type: 'integer' } } } }],
  sequential: () => true,
  call: async (_: string, args: Record<string, unknown>) => ({
    content: [{ type: 'text', text: `state ${String(args.window)}` }, { type: 'image', data: 'png', mimeType: 'image/png' }],
    superseded: `old state ${String(args.window)}`
  })
}

describe("the bench's Gemini backend (Llama Run's loop, direct API)", () => {
  afterEach(() => vi.unstubAllGlobals())

  it('runs function calls through the tools, returns signatures, prunes old states and answers', async () => {
    const bodies: Record<string, any>[] = []
    let n = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toContain('/models/gemini-3.8-flash:generateContent')
        expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k')
        bodies.push(JSON.parse(String(init.body)))
        n++
        const parts =
          n === 1
            ? [{ text: 'Looking.' }, call('computer_look', { window: 1 }, { thoughtSignature: 'sig1' })]
            : n === 2
              ? [call('computer_look', { window: 2 })]
              : [{ text: 'Done.' }]
        return ok({ candidates: [{ content: { role: 'model', parts } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 } })
      })
    )
    const usage = { inputTokens: 0, outputTokens: 0, requests: 0 }
    const out = await generateGemini('open it', { model: 'gemini-3.8-flash', apiKey: 'k', tools, system: 'Be careful.' }, usage)

    expect(out).toBe('Looking.\n\nDone.')
    expect(usage).toEqual({ inputTokens: 30, outputTokens: 6, requests: 3 })
    expect(bodies[0].systemInstruction).toEqual({ parts: [{ text: 'Be careful.' }] })
    // Schemas go out compacted, as the app sends them.
    expect(bodies[0].tools[0].functionDeclarations[0]).toEqual({ name: 'computer_look', description: 'Read a window.', parameters: { type: 'object', properties: { window: { type: 'integer' } } } })
    const last = bodies[2].contents
    // The model's turn is echoed with its thought signature.
    expect(last[1]).toEqual({ role: 'model', parts: [{ text: 'Looking.' }, call('computer_look', { window: 1 }, { thoughtSignature: 'sig1' })] })
    // Text-only results; the older window state is cut to its short form.
    expect(last[2].parts[0].functionResponse).toEqual({ name: 'computer_look', response: { result: 'old state 1' } })
    expect(last[4].parts[0].functionResponse).toEqual({ name: 'computer_look', response: { result: 'state 2\n[image image/png]' } })
  })

  it('sends the last round without tools at the step cap, and retries rate limits', async () => {
    const bodies: Record<string, any>[] = []
    let first = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        if (first) {
          first = false
          return new Response('{}', { status: 429 })
        }
        const body = JSON.parse(String(init.body))
        bodies.push(body)
        return ok({ candidates: [{ content: { role: 'model', parts: body.tools ? [call('computer_look', { window: bodies.length })] : [{ text: 'Stopped.' }] } }] })
      })
    )
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const run = generateGemini('loop', { model: 'm', apiKey: 'k', tools, maxToolRounds: 2 })
    await vi.runAllTimersAsync()
    const out = await run
    vi.useRealTimers()
    expect(out).toBe('Stopped.')
    expect(bodies.map((b) => Boolean(b.tools))).toEqual([true, true, false])
  })

  it('reports API errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 })))
    await expect(generateGemini('x', { model: 'm', apiKey: 'bad', tools })).rejects.toThrow('Gemini 400: API key not valid')
  })
})
