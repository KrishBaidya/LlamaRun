import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalAnswer, ApprovalRequest } from '../src/shared/types'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-code-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData, isPackaged: false, getAppPath: () => process.cwd(), getVersion: () => '0' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {}
}))

const { runCode, toolsModule, pythonName, clip, MAX_TOOL_CALLS } = await import('../src/main/assistant/codeMode')
const { approvals } = await import('../src/main/assistant/approval')
const { pythonExecutable } = await import('../src/main/paths')
import type { ToolBridge } from '../src/main/llm/types'

const { toolResultToText } = await import('../src/main/llm/toolPayload')
const text = (r: Parameters<typeof toolResultToText>[0]): string => toolResultToText(r)

function answerWith(answer: ApprovalAnswer): ApprovalRequest[] {
  const asked: ApprovalRequest[] = []
  approvals.removeAllListeners('changed')
  approvals.on('changed', (_chat, request) => {
    if (!request) return
    asked.push(request)
    queueMicrotask(() => approvals.answer(request.id, answer))
  })
  return asked
}

/** Tools a script can call: two that work, one that fails, each call recorded. */
function bridge(): ToolBridge & { calls: { name: string; args: Record<string, unknown> }[] } {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const ok = (t: string) => ({ content: [{ type: 'text', text: t }], isError: false })
  return {
    calls,
    tools: ['read_file', 'render_html', 'broken', 'my-mcp_tool'].map((name) => ({ name, server: 'test', description: '', inputSchema: {} })),
    call: async (name, args) => {
      calls.push({ name, args })
      if (name === 'read_file') return ok(`contents of ${String(args.path)}`)
      if (name === 'broken') return { content: [{ type: 'text', text: 'it broke' }], isError: true }
      return ok(`${name} done`)
    }
  }
}

const hasPython = existsSync(pythonExecutable())

afterEach(() => approvals.removeAllListeners('changed'))
afterAll(() => rmSync(userData, { recursive: true, force: true }))

describe('run_code helpers', () => {
  it('names every tool as a Python function, and leaves run_code itself out', () => {
    const module = toolsModule(['read_file', 'my-mcp_tool', '9lives', 'run_code'])
    expect(module).toContain('read_file = _tool("read_file")')
    expect(module).toContain('my_mcp_tool = _tool("my-mcp_tool")')
    expect(module).toContain('t_9lives = _tool("9lives")')
    expect(module).not.toContain('run_code = ')
    expect(pythonName('a.b')).toBe('a_b')
  })

  it('keeps the start and end of long output', () => {
    const long = 'a'.repeat(20_000) + 'END'
    expect(clip(long).length).toBeLessThan(15_000)
    expect(clip(long).endsWith('END')).toBe(true)
    expect(clip('short')).toBe('short')
  })
})

describe.skipIf(!hasPython)('run_code', () => {
  // Hermes' execute_code: a multi-step job is one model turn, and only what the script prints comes back.
  it('runs a script that calls tools as functions; only what it prints comes back', async () => {
    answerWith('once')
    const tools = bridge()
    const code = [
      'from llamarun_tools import read_file, render_html',
      'texts = [read_file(path=f"{n}.txt") for n in ("a", "b", "c")]',
      'render_html(html="<p>" + str(len(texts)) + "</p>", output="out.pdf")',
      'print("read", len(texts), "files; first:", texts[0])'
    ].join('\n')
    const r = await runCode({ code }, tools, { chatId: 'c1' })
    expect(r.isError).toBe(false)
    expect(text(r)).toContain('read 3 files; first: contents of a.txt')
    expect(text(r)).not.toContain('contents of b.txt')
    expect(text(r)).toContain('(4 tool calls)')
    expect(tools.calls.map((c) => c.name)).toEqual(['read_file', 'read_file', 'read_file', 'render_html'])
    expect(tools.calls[3].args).toEqual({ html: '<p>3</p>', output: 'out.pdf' })
  }, 30_000)

  it('raises ToolError when a tool fails, and the script can catch it', async () => {
    answerWith('once')
    const code = [
      'import llamarun_tools as t',
      'try:',
      '    t.broken()',
      'except t.ToolError as e:',
      '    print("caught:", e)',
      'print(t.my_mcp_tool())'
    ].join('\n')
    const r = await runCode({ code }, bridge(), { chatId: 'c1' })
    expect(text(r)).toContain('caught: it broke')
    expect(text(r)).toContain('my-mcp_tool done')
  }, 30_000)

  it(`stops a script after ${MAX_TOOL_CALLS} tool calls`, async () => {
    answerWith('once')
    const code = [
      'from llamarun_tools import read_file, ToolError',
      'n = 0',
      'try:',
      '    for i in range(80):',
      '        read_file(path="x")',
      '        n += 1',
      'except ToolError as e:',
      '    print(n, "calls, then:", e)'
    ].join('\n')
    const tools = bridge()
    const r = await runCode({ code }, tools, { chatId: 'c1' })
    expect(text(r)).toContain(`${MAX_TOOL_CALLS} calls, then:`)
    expect(tools.calls).toHaveLength(MAX_TOOL_CALLS)
  }, 30_000)

  it('reports errors and timeouts', async () => {
    answerWith('once')
    const failed = await runCode({ code: 'raise ValueError("bad input")' }, bridge(), { chatId: 'c1' })
    expect(failed.isError).toBe(true)
    expect(text(failed)).toContain('ValueError: bad input')
    const slow = await runCode({ code: 'import time\ntime.sleep(30)', timeout: 5 }, bridge(), { chatId: 'c1' })
    expect(text(slow)).toContain('Stopped after 5 seconds')
  }, 30_000)

  it('asks before running code, and "Allow code for this chat" lasts for the chat', async () => {
    let asked = answerWith('deny')
    await expect(runCode({ code: 'print(1)' }, bridge(), { chatId: 'c9' })).rejects.toThrow('denied')
    expect(asked[0]).toMatchObject({ title: 'Run this Python code?', command: 'print(1)' })
    asked = answerWith('always')
    await runCode({ code: 'print(1)' }, bridge(), { chatId: 'c9' })
    await runCode({ code: 'print(2)' }, bridge(), { chatId: 'c9' })
    expect(asked).toHaveLength(1)
  }, 30_000)
})
