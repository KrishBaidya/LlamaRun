import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloudBody, generateCloud, setStructuredSupported, textOf, thinkingOf, toolCallOf } from '../src/main/llm/cloud'
import { keepNewestImages, type Turn } from '../src/main/llm/conversation'
import { toolResultToText, toolSpecs } from '../src/main/llm/toolPayload'
import { MAX_TOOL_ROUNDS, toHistory, type ToolPause } from '../src/main/llm/types'

function streamResponse(parts: unknown[]): Response {
  return new Response(parts.map((p) => JSON.stringify(p)).join(''), { status: 200 })
}

describe('cloud stream events', () => {
  it('reads text in every AI SDK shape', () => {
    expect(textOf({ text: { type: 'text-delta', text: 'a' } })).toBe('a')
    expect(textOf({ text: { type: 'text-delta', textDelta: 'b' } })).toBe('b')
    expect(textOf({ type: 'text-delta', delta: 'c' })).toBe('c')
    expect(textOf({ text: { type: 'tool-call', toolName: 't' } })).toBe('')
  })

  it("reads a thinking model's reasoning apart from its text", async () => {
    expect(thinkingOf({ text: { type: 'reasoning-delta', text: '**Plan**' } })).toBe('**Plan**')
    expect(textOf({ text: { type: 'reasoning-delta', text: '**Plan**' } })).toBe('')
    expect(thinkingOf({ text: { type: 'text-delta', text: 'a' } })).toBe('')
    vi.stubGlobal('fetch', vi.fn(async () => streamResponse([{ text: { type: 'reasoning-delta', id: 'r', text: 'Thinking it over.' } }, { text: { type: 'text-delta', text: 'Hi.' } }, { done: 'True' }])))
    const thoughts: string[] = []
    const out = await generateCloud('Hello', { model: 'gemini-3.8-flash', token: 't', onThinking: (t) => thoughts.push(t) })
    vi.unstubAllGlobals()
    expect(out).toBe('Hi.')
    expect(thoughts).toEqual(['Thinking it over.'])
  })

  it('reads tool arguments from args, input or a JSON string', () => {
    const shape = { type: 'tool-call', toolCallId: '1', toolName: 'execute_blender_code' }
    const code = { code: 'import bpy' }
    expect(toolCallOf({ text: { ...shape, args: code } })?.args).toEqual(code)
    expect(toolCallOf({ text: { ...shape, input: code } })?.args).toEqual(code)
    expect(toolCallOf({ text: { ...shape, input: JSON.stringify(code) } })?.args).toEqual(code)
    expect(toolCallOf({ ...shape, arguments: code })?.args).toEqual(code)
    expect(toolCallOf({ text: { ...shape } })?.args).toEqual({})
    expect(toolCallOf({ text: { type: 'text-delta', text: 'x' } })).toBeNull()
  })
})

describe('generateCloud tool calls', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('passes the model’s arguments to every tool it calls, then continues', async () => {
    const bodies: { messages: Record<string, unknown>[] }[] = []
    const urls: string[] = []
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      urls.push(url)
      bodies.push(JSON.parse(String(init.body)))
      if (bodies.length === 1) {
        return streamResponse([
          { text: { type: 'tool-call', toolCallId: 'a', toolName: 'get_scene_info', input: {} } },
          { text: { type: 'tool-call', toolCallId: 'b', toolName: 'execute_blender_code', input: { code: 'bpy.ops.mesh.primitive_cube_add()' } } },
          { done: 'True' }
        ])
      }
      return streamResponse([{ text: { type: 'text-delta', text: 'Added a cube.' } }, { done: 'True' }])
    })
    vi.stubGlobal('fetch', fetchMock)

    const call = vi.fn(async (name: string) => ({ content: [{ type: 'text', text: `${name} ok` }], isError: false }))
    const onTool = vi.fn()
    const out = await generateCloud('Create a cube', {
      model: 'gemini-2.5-flash',
      token: 't',
      onTool,
      tools: {
        tools: [
          { name: 'get_scene_info', description: '', server: 'blender-mcp', inputSchema: {} },
          { name: 'execute_blender_code', description: '', server: 'blender-mcp', inputSchema: {} }
        ],
        call
      }
    } as never)

    expect(out).toBe('Added a cube.')
    expect(urls).toHaveLength(2)
    expect(urls.every((u) => u.endsWith('/api/v1/llm/generate'))).toBe(true)
    expect(call.mock.calls).toEqual([
      ['get_scene_info', {}],
      ['execute_blender_code', { code: 'bpy.ops.mesh.primitive_cube_add()' }]
    ])
    expect(onTool).toHaveBeenCalledTimes(2)
    // Real turns: the calls in one assistant turn, each result its own tool turn naming its call.
    const followUp = bodies[1].messages
    expect(followUp.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool'])
    expect(followUp[1]).toEqual({
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: 'a', name: 'get_scene_info', args: {} },
        { id: 'b', name: 'execute_blender_code', args: { code: 'bpy.ops.mesh.primitive_cube_add()' } }
      ]
    })
    expect(followUp[3]).toEqual({ role: 'tool', toolCallId: 'b', toolName: 'execute_blender_code', content: 'execute_blender_code ok' })
  })

  it('returns Gemini 3 thought signatures with their calls, and sends a screenshot inside the result to vision models', async () => {
    const bodies: { messages: Record<string, unknown>[]; thinking?: string }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)))
        if (bodies.length === 1) {
          return streamResponse([
            { text: { type: 'tool-call', toolCallId: 'a', toolName: 'look', input: {}, providerMetadata: { google: { thoughtSignature: 'sig' } } } },
            { done: 'True' }
          ])
        }
        return streamResponse([{ text: { type: 'text-delta', text: 'It shows a cube.' } }, { done: 'True' }])
      })
    )
    const call = async (): Promise<{ content: unknown[] }> => ({ content: [{ type: 'text', text: 'state' }, { type: 'image', data: 'iVBOR', mimeType: 'image/png' }] })
    await generateCloud('what is open?', {
      model: 'm',
      token: 't',
      vision: true,
      thinking: 'low',
      tools: { tools: [{ name: 'look', description: '', server: 's', inputSchema: {} }], call }
    } as never)
    expect(bodies[0].thinking).toBe('low')
    expect(bodies[1].messages[1]).toMatchObject({ toolCalls: [{ id: 'a', name: 'look', thoughtSignature: 'sig' }] })
    expect(bodies[1].messages[2]).toEqual({ role: 'tool', toolCallId: 'a', toolName: 'look', content: 'state\n[image image/png]', images: [{ data: 'iVBOR', mediaType: 'image/png' }] })
  })

  it("never sends Ollama's off/on to the server, which takes levels only", async () => {
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => (bodies.push(JSON.parse(String(init.body))), streamResponse([{ text: { type: 'text-delta', text: 'ok' } }, { done: 'True' }]))))
    await generateCloud('hi', { model: 'm', token: 't', thinking: 'on' })
    await generateCloud('hi', { model: 'm', token: 't', thinking: 'high' })
    expect(bodies.map((b) => b.thinking)).toEqual([undefined, 'high'])
  })

  it('falls back to the JSON-encoded prompt on a server from before structured messages', async () => {
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        bodies.push(body)
        if (!body.prompt) return new Response(JSON.stringify({ code: 'INVALID_BODY', issues: [{ path: 'prompt', message: 'prompt is required' }] }), { status: 400 })
        return streamResponse([{ text: { type: 'text-delta', text: 'ok' } }, { done: 'True' }])
      })
    )
    const history = [
      { role: 'user' as const, content: 'hi' },
      { role: 'assistant' as const, content: 'hello' },
      { role: 'user' as const, content: 'time?' }
    ]
    expect(await generateCloud(history, { model: 'm', token: 't', system: 'Answer aloud.' } as never)).toBe('ok')
    expect(bodies).toHaveLength(2)
    const pairs = JSON.parse(String(bodies[1].prompt)) as { Key: string; Value: string }[]
    expect(pairs.map((p) => p.Value)).toEqual(['hi', 'hello', 'Answer aloud.\n\ntime?'])
    // Remembered: the next request goes straight to the old format.
    await generateCloud('again', { model: 'm', token: 't' } as never)
    expect(bodies).toHaveLength(3)
    expect(bodies[2].prompt).toBe('again')
    setStructuredSupported(true)
  })
})

describe('conversation turns', () => {
  it('keeps only the newest screenshot', () => {
    const turns: Turn[] = [
      { role: 'user', content: 'go' },
      { role: 'tool', toolCallId: '1', toolName: 'computer_look', content: 'state', images: [{ data: 'old', mediaType: 'image/png' }] },
      { role: 'tool', toolCallId: '2', toolName: 'computer_look', content: 'state', images: [{ data: 'new', mediaType: 'image/png' }] }
    ]
    keepNewestImages(turns)
    expect(turns[1]).not.toHaveProperty('images')
    expect((turns[2] as { images: unknown[] }).images).toHaveLength(1)
  })

  it("sends the model's earlier tool calls back exactly as it made them, long arguments included", async () => {
    // Cutting them to "[N characters]" made Gemini send that placeholder as Blender code in a real chat.
    const code = `import bpy\n${'x = 1\n'.repeat(100)}`
    const bodies: { messages: { role: string; toolCalls?: { args: Record<string, unknown> }[] }[] }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)))
        const n = bodies.length
        const parts = n <= 2 ? [{ text: { type: 'tool-call', toolCallId: `c${n}`, toolName: 'execute_blender_code', input: { code } } }] : [{ text: { type: 'text-delta', text: 'Done.' } }]
        return streamResponse([...parts, { done: 'True' }])
      })
    )
    await generateCloud('rig it', {
      model: 'm',
      token: 't',
      tools: { tools: [{ name: 'execute_blender_code', description: '', server: 'blender', inputSchema: {} }], call: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }
    } as never)
    const calls = bodies.at(-1)!.messages.filter((m) => m.role === 'assistant').flatMap((m) => m.toolCalls ?? [])
    expect(calls.map((c) => c.args.code)).toEqual([code, code])
    vi.unstubAllGlobals()
  })

  it('builds the legacy body without images except for the newest user message', () => {
    const body = cloudBody([{ role: 'user', content: 'see', images: [{ data: 'img', mediaType: 'image/png' }] }], undefined, false)
    expect(body).toEqual({ prompt: 'see', images: [{ data: 'img', mediaType: 'image/png' }] })
  })
})

describe('tool payload', () => {
  it('strips schema noise but keeps parameters named like noise keys', () => {
    const tool = {
      name: 'set_title',
      server: 's',
      description: '  Sets a title.\n\n    Parameters:\n      - title: the new title\n',
      inputSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        title: 'set_titleArguments',
        type: 'object',
        properties: { title: { title: 'Title', type: 'string', description: 'New title' } },
        required: ['title']
      }
    }
    const [spec] = toolSpecs([tool])
    expect(spec.description).toBe('Sets a title.\nParameters:\n- title: the new title')
    expect(spec.parameters).toEqual({
      type: 'object',
      properties: { title: { type: 'string', description: 'New title' } },
      required: ['title']
    })
    expect(toolSpecs([tool])[0]).toBe(spec)
  })

  it('replaces images with a placeholder and truncates long results', () => {
    const image = { content: [{ type: 'image', data: 'A'.repeat(100_000), mimeType: 'image/png' }] }
    expect(toolResultToText(image)).toBe('[image image/png]')
    const long = toolResultToText({ content: [{ type: 'text', text: 'x'.repeat(50) }], isError: true }, 20)
    expect(long).toBe(`Tool error: ${'x'.repeat(8)}\n…[truncated 42 characters]`)
  })

  it('keeps the newest history that fits, starting on a user turn', () => {
    const history = [
      { role: 'user' as const, content: 'a'.repeat(40) },
      { role: 'assistant' as const, content: 'b'.repeat(40) },
      { role: 'user' as const, content: 'c'.repeat(10) },
      { role: 'assistant' as const, content: 'd'.repeat(10) },
      { role: 'user' as const, content: 'e'.repeat(200) }
    ]
    expect(toHistory(history, 100).map((m) => m.content[0])).toEqual(['e'])
    expect(toHistory(history, 250).map((m) => m.content[0])).toEqual(['c', 'd', 'e'])
    expect(toHistory(history, 10_000)).toHaveLength(5)
  })

  it('sends no tools on the last round', async () => {
    const bodies: { Tools?: unknown }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)))
        return streamResponse([{ text: { type: 'tool-call', toolCallId: 'x', toolName: 'loop', input: {} } }, { done: 'True' }])
      })
    )
    await generateCloud('go', {
      model: 'gemini-2.5-flash',
      token: 't',
      tools: {
        tools: [{ name: 'loop', description: '', server: 's', inputSchema: {} }],
        call: async () => ({ content: [{ type: 'text', text: 'ok' }] })
      }
    } as never)
    expect(bodies).toHaveLength(MAX_TOOL_ROUNDS + 1)
    expect(bodies.slice(0, -1).every((b) => Array.isArray(b.Tools))).toBe(true)
    expect(bodies.at(-1)?.Tools).toBeUndefined()
  })
})

describe('pausing at the tool-round cap', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('pauses with the pending calls, then resumes without repeating work', async () => {
    const bodies: { messages: Record<string, unknown>[]; Tools?: unknown }[] = []
    let finish = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)))
        return streamResponse(
          finish
            ? [{ text: { type: 'text-delta', text: 'Done.' } }, { done: 'True' }]
            : [{ text: { type: 'tool-call', toolCallId: `c${bodies.length}`, toolName: 'step', input: { n: bodies.length } } }, { done: 'True' }]
        )
      })
    )
    const call = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    const tools = { tools: [{ name: 'step', description: '', server: 's', inputSchema: {} }], call }
    let pause: ToolPause | undefined
    const first = await generateCloud('go', { model: 'm', token: 't', tools, onPause: (p: ToolPause) => (pause = p) } as never)

    expect(first).toBe('')
    expect(bodies).toHaveLength(MAX_TOOL_ROUNDS + 1)
    expect(bodies.every((b) => Array.isArray(b.Tools))).toBe(true)
    expect(call).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS)
    expect(pause?.backend).toBe('cloud')

    finish = true
    const onTool = vi.fn()
    const second = await generateCloud('ignored', { model: 'm', token: 't', tools, onTool, resume: pause } as never)

    expect(second).toBe('Done.')
    expect(bodies).toHaveLength(MAX_TOOL_ROUNDS + 2)
    // Only the held call runs, with the arguments the model gave it.
    expect(call).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS + 1)
    expect(call.mock.calls.at(-1)).toEqual(['step', { n: MAX_TOOL_ROUNDS + 1 }])
    expect(onTool).toHaveBeenCalledTimes(1)
    const messages = bodies.at(-1)!.messages
    expect(messages[0]).toEqual({ role: 'user', content: 'go' })
    expect(messages).toHaveLength(1 + 2 * (MAX_TOOL_ROUNDS + 1))
  })
})

describe('turn instructions', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('go as the system prompt, apart from the conversation', async () => {
    const bodies: { messages: { content: string }[]; system?: string }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)))
        return streamResponse([{ text: { type: 'text-delta', text: 'ok' } }, { done: 'True' }])
      })
    )
    const history = [
      { role: 'user' as const, content: 'hi' },
      { role: 'assistant' as const, content: 'hello' },
      { role: 'user' as const, content: 'time?' }
    ]
    await generateCloud(history, { model: 'm', token: 't', system: 'Answer aloud.' } as never)
    expect(bodies[0].system).toBe('Answer aloud.')
    expect(bodies[0].messages.map((m) => m.content)).toEqual(['hi', 'hello', 'time?'])
    expect(history[2].content).toBe('time?')
  })
})
