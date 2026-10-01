import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateCloud, textOf, toolCallOf } from '../src/main/llm/cloud'
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
    const bodies: { prompt: string }[] = []
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
    const followUp = JSON.parse(bodies[1].prompt) as { Key: string; Value: unknown }[]
    expect(followUp.map((p) => p.Key)).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
    expect(JSON.parse(String(followUp[3].Value)).args).toEqual({ code: 'bpy.ops.mesh.primitive_cube_add()' })
    expect(followUp[4].Value).toEqual({ content: [{ type: 'text', text: 'execute_blender_code ok' }] })
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
    const bodies: { prompt: string; Tools?: unknown }[] = []
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
    const prompt = JSON.parse(bodies.at(-1)!.prompt) as { Key: string }[]
    expect(prompt[0]).toEqual({ Key: 'user', Value: 'go' })
    expect(prompt).toHaveLength(1 + 2 * (MAX_TOOL_ROUNDS + 1))
  })
})

describe('turn instructions', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lead the newest user message, since the backend has no system prompt', async () => {
    const bodies: { prompt: string }[] = []
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
    const pairs = JSON.parse(bodies[0].prompt) as { Key: string; Value: string }[]
    expect(pairs.map((p) => p.Value)).toEqual(['hi', 'hello', 'Answer aloud.\n\ntime?'])
    expect(history[2].content).toBe('time?')
  })
})
