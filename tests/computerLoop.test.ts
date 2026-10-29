import { afterEach, describe, expect, it, vi } from 'vitest'
import type { McpToolResult } from '../src/main/mcp/manager'

// A fake Ollama: the model calls `look` on each round until `rounds` run out, then answers.
const ollama = vi.hoisted(() => ({ requests: [] as { messages: Record<string, unknown>[]; tools?: unknown }[], rounds: 3 }))
vi.mock('ollama', () => ({
  Ollama: class {
    abort(): void {}
    async chat(req: { messages: Record<string, unknown>[]; tools?: unknown }): Promise<AsyncIterable<unknown>> {
      // Copy, since the loop edits earlier messages in place when they're superseded.
      ollama.requests.push({ ...req, messages: req.messages.map((m) => ({ ...m })) })
      const n = ollama.requests.length
      const message =
        n <= ollama.rounds && req.tools
          ? { content: '', tool_calls: [{ function: { name: 'look', arguments: { n } } }] }
          : { content: 'Done.' }
      return (async function* () {
        yield { message }
      })()
    }
  }
}))

const { generateCloud } = await import('../src/main/llm/cloud')
const { generateOllama } = await import('../src/main/llm/ollama')

/** A window state: long text plus a screenshot, replaced by its short form once a newer one exists. */
const state = (n: number): McpToolResult => ({
  content: [
    { type: 'text', text: `full state ${n}` },
    { type: 'image', data: `png${n}`, mimeType: 'image/png' }
  ],
  superseded: `old state ${n}`
})
const tools = { tools: [{ name: 'look', description: '', server: 'Computer use', inputSchema: {} }], call: async (_: string, a: Record<string, unknown>) => state(Number(a.n)) }

describe('computer-use turns with Ollama', () => {
  afterEach(() => {
    ollama.requests = []
    ollama.rounds = 3
  })

  it('sends the newest screenshot to vision models and cuts older states', async () => {
    const out = await generateOllama('open notepad', { model: 'qwen-vl', tools, vision: true } as never)
    expect(out).toBe('Done.')
    const last = ollama.requests.at(-1)!.messages.filter((m) => m.role === 'tool')
    expect(last.map((m) => m.content)).toEqual(['old state 1', 'old state 2', 'full state 3\n[image image/png]'])
    expect(last.map((m) => m.images)).toEqual([undefined, undefined, ['png3']])
  })

  it('keeps screenshots away from models that cannot see', async () => {
    await generateOllama('open notepad', { model: 'llama3', tools } as never)
    const toolMessages = ollama.requests.at(-1)!.messages.filter((m) => m.role === 'tool')
    expect(toolMessages.every((m) => m.images === undefined)).toBe(true)
    expect(toolMessages.at(-1)!.content).toBe('full state 3\n[image image/png]')
  })

  it('runs more rounds than a normal chat when allowed', async () => {
    ollama.rounds = 12
    const out = await generateOllama('do a long task', { model: 'llama3', tools, maxToolRounds: 20 } as never)
    expect(out).toBe('Done.')
    expect(ollama.requests).toHaveLength(13)
  })
})

describe('computer-use turns with cloud models', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('cuts older window states from later requests and honours the step cap', async () => {
    const prompts: { Key: string; Value: unknown }[][] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { prompt: string; Tools?: unknown }
        prompts.push(prompts.length ? JSON.parse(body.prompt) : [])
        const n = prompts.length
        const part = body.Tools ? { text: { type: 'tool-call', toolCallId: `c${n}`, toolName: 'look', input: { n } } } : { text: { type: 'text-delta', text: 'Done.' } }
        return new Response(JSON.stringify(part) + JSON.stringify({ done: 'True' }), { status: 200 })
      })
    )
    const out = await generateCloud('go', { model: 'gemini-2.5-flash', token: 't', tools, maxToolRounds: 3 } as never)
    expect(out).toBe('Done.')
    // Three rounds with tools, then one without, so the model answers.
    expect(prompts).toHaveLength(4)
    const results = prompts.at(-1)!.filter((p) => p.Key === 'user').slice(1)
    expect(results.map((p) => (p.Value as { content: { text: string }[] }).content[0].text)).toEqual([
      'old state 1',
      'old state 2',
      'full state 3\n[image image/png]'
    ])
  })
})
