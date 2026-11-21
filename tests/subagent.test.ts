import { describe, expect, it, vi } from 'vitest'
import type { McpToolInfo } from '../src/shared/types'
import type { GenerateOptions, ToolBridge } from '../src/main/llm/types'

vi.mock('electron', () => ({ app: { getPath: () => '.', isPackaged: false, getAppPath: () => '.' } }))
const { childTools, runSubagent, MAX_PARALLEL, answerText } = await import('../src/main/chats/subagent')
const { allowedTools } = await import('../src/main/assistant/planMode')

const tool = (name: string): McpToolInfo => ({ name, server: 'Llama Run', description: '', inputSchema: {} })
const parentTools = ['read_file', 'file_grep', 'write_file', 'run_command', 'agent_run', 'ask_user', 'mcp_thing'].map(tool)
const bridge: ToolBridge = { tools: parentTools, call: vi.fn(async (name: string) => ({ content: [{ type: 'text', text: `${name} ok` }] })) }

describe('childTools', () => {
  it("gets the chat's tools to do the task, never agent_run or ask_user; read-only when asked", () => {
    expect(childTools(parentTools, false).map((t) => t.name)).toEqual(['read_file', 'file_grep', 'write_file', 'run_command', 'mcp_thing'])
    expect(childTools(parentTools, true).map((t) => t.name)).toEqual(['read_file', 'file_grep'])
  })
})

describe('plan mode', () => {
  it('keeps reading, asking and read-only sub-agents only', () => {
    const tools = ['read_file', 'file_grep', 'write_file', 'run_command', 'ask_user', 'agent_run', 'todo_update', 'some_mcp_tool'].map((name) => ({ name }))
    expect(allowedTools(tools, { plan: true }).map((t) => t.name)).toEqual(['read_file', 'file_grep', 'ask_user', 'agent_run', 'todo_update'])
    expect(allowedTools(tools, {})).toHaveLength(tools.length)
  })
})

describe('runSubagent', () => {
  it("does the task with the chat's model and tools, and returns only the answer with steps", async () => {
    let seen: GenerateOptions | undefined
    const generate = vi.fn(async (_input: unknown, opts: GenerateOptions) => {
      seen = opts
      opts.onTool?.({ id: '1', name: 'write_file', server: 'Llama Run', args: { path: 'a.txt' } })
      await opts.tools!.call('write_file', { path: 'a.txt' })
      opts.onToolResult?.('1', { content: [] })
      // A tool it doesn't have is refused even if the model asks.
      const refused = await opts.tools!.call('agent_run', { task: 'more' })
      expect(refused.isError).toBe(true)
      return 'Wrote a.txt'
    })
    const result = await runSubagent({ task: 'write x' }, { bridge, model: 'parent-model', generate })
    expect(answerText(result)).toContain('Wrote a.txt')
    expect(result.steps).toEqual([{ name: 'write_file', status: 'done', hint: 'a.txt' }])
    expect(seen!.model).toBe('parent-model')
    expect(seen!.tools!.tools.map((t) => t.name)).toEqual(['read_file', 'file_grep', 'write_file', 'run_command', 'mcp_thing'])
  })

  it('only reads in plan mode or when the model asks', async () => {
    const names: string[][] = []
    const generate = vi.fn(async (_input: unknown, opts: GenerateOptions) => (names.push(opts.tools!.tools.map((t) => t.name)), 'ok'))
    await runSubagent({ task: 'x' }, { bridge, model: 'm', generate, readOnly: true })
    await runSubagent({ task: 'x', read_only: true }, { bridge, model: 'm', generate })
    expect(names).toEqual([
      ['read_file', 'file_grep'],
      ['read_file', 'file_grep']
    ])
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
    await Promise.all(Array.from({ length: MAX_PARALLEL + 3 }, () => runSubagent({ task: 't' }, { bridge, model: 'm', generate })))
    expect(peak).toBe(MAX_PARALLEL)
  })
})
