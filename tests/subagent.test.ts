import { describe, expect, it, vi } from 'vitest'
import type { AgentInfo, McpToolInfo } from '../src/shared/types'
import type { GenerateOptions, ToolBridge } from '../src/main/llm/types'

vi.mock('electron', () => ({ app: { getPath: () => '.', isPackaged: false, getAppPath: () => '.' } }))
const { childTools, runSubagent, MAX_PARALLEL, answerText } = await import('../src/main/chats/subagent')

const tool = (name: string): McpToolInfo => ({ name, server: 'Llama Run', description: '', inputSchema: {} })
const parentTools = ['read_file', 'file_grep', 'write_file', 'run_command', 'agent_run', 'ask_user', 'mcp_thing'].map(tool)
const bridge: ToolBridge = { tools: parentTools, call: vi.fn(async (name: string) => ({ content: [{ type: 'text', text: `${name} ok` }] })) }

const writer: AgentInfo = { id: 'llamarun:writer', name: 'writer', description: 'Writes files', tools: ['read_file', 'write_file'], prompt: 'You write tidy files.', location: 'llamarun', file: 'x', model: 'gemini-x' }
const all: AgentInfo = { ...writer, id: 'llamarun:all', name: 'all', tools: '*' }

describe('childTools', () => {
  it('is read-only by default and never offers agent_run or ask_user', () => {
    expect(childTools(parentTools, undefined).map((t) => t.name)).toEqual(['read_file', 'file_grep'])
    expect(childTools(parentTools, '*').map((t) => t.name)).toEqual(['read_file', 'file_grep', 'write_file', 'run_command', 'mcp_thing'])
    expect(childTools(parentTools, writer.tools).map((t) => t.name)).toEqual(['read_file', 'write_file'])
  })
})

describe('runSubagent', () => {
  it('runs the task with its agent prompt, model and tools, and returns only the answer with steps', async () => {
    let seen: GenerateOptions | undefined
    const generate = vi.fn(async (input: unknown, opts: GenerateOptions) => {
      seen = opts
      opts.onTool?.({ id: '1', name: 'read_file', server: 'Llama Run', args: { path: 'a.txt' } })
      await opts.tools!.call('read_file', { path: 'a.txt' })
      opts.onToolResult?.('1', { content: [] })
      // A tool the agent may not use is refused even if the model asks.
      const refused = await opts.tools!.call('run_command', { command: 'del *' })
      expect(refused.isError).toBe(true)
      return 'Found it in a.txt'
    })
    const result = await runSubagent({ task: 'find x', agent: 'writer' }, { bridge, model: 'parent-model', generate, findAgent: (n) => (n === 'writer' ? writer : undefined) })
    expect(answerText(result)).toContain('Found it in a.txt')
    expect(result.steps).toEqual([{ name: 'read_file', status: 'done', hint: 'a.txt' }])
    expect(seen!.model).toBe('gemini-x')
    expect(seen!.system).toContain('You write tidy files.')
    expect(seen!.tools!.tools.map((t) => t.name)).toEqual(['read_file', 'write_file'])
    expect(seen!.onPause).toBeUndefined()
  })

  it('rejects an unknown agent', async () => {
    const r = await runSubagent({ task: 'x', agent: 'nobody' }, { bridge, model: 'm', generate: vi.fn(), findAgent: () => undefined })
    expect(r.isError).toBe(true)
  })

  it('runs at most MAX_PARALLEL at once', async () => {
    let running = 0
    let peak = 0
    const generate = async (): Promise<string> => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 10))
      running--
      return 'ok'
    }
    await Promise.all(Array.from({ length: MAX_PARALLEL + 3 }, () => runSubagent({ task: 't', agent: 'all' }, { bridge, model: 'm', generate, findAgent: () => all })))
    expect(peak).toBe(MAX_PARALLEL)
  })
})
