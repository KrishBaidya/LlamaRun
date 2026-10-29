import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent, ChatMessage, MessagePart, ToolPart } from '../src/shared/types'

vi.mock('electron', () => ({
  app: { getPath: () => '.', isPackaged: false, getAppPath: () => '.', getVersion: () => '0' },
  globalShortcut: { register: () => true, unregister: () => {} },
  BrowserWindow: class {},
  dialog: {},
  Notification: class {},
  safeStorage: {},
  screen: {},
  shell: {},
  utilityProcess: {}
}))

// A model that says something, calls a tool, then answers: the shape of a real tool-using reply.
const model = vi.hoisted(() => ({ script: null as null | ((opts: Record<string, unknown>) => Promise<string>) }))
vi.mock('../src/main/llm', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/main/llm')>()
  return {
    ...real,
    modelCatalog: async () => ({ groups: [], ollamaRunning: false }),
    generate: (_input: unknown, opts: Record<string, unknown>) => model.script!(opts)
  }
})

const { appendText, finishTool, recalledReplies, replaceText, replyForModel, textOf, toolPart } = await import('../src/main/chats/parts')
const { chatService, historyFor } = await import('../src/main/chats/service')
const { pluginHost } = await import('../src/main/plugins/host')
const { joinRound, runToolCalls } = await import('../src/main/llm/toolRun')

describe('message parts', () => {
  it('keeps text and tool calls in the order they happened', () => {
    const parts: MessagePart[] = []
    appendText(parts, 'Let me ')
    appendText(parts, 'open Notepad.')
    const tool = toolPart('t1', 'computer_open', 'Computer use', { app: 'Notepad' })
    parts.push(tool)
    finishTool(tool, { content: [{ type: 'text', text: 'Opened Notepad.' }, { type: 'image', data: 'x', mimeType: 'image/png' }] })
    appendText(parts, 'Done.')
    expect(parts).toEqual([
      { type: 'text', text: 'Let me open Notepad.' },
      { type: 'tool', id: 't1', name: 'computer_open', server: 'Computer use', args: { app: 'Notepad' }, status: 'done', result: 'Opened Notepad.\n[image image/png]' },
      { type: 'text', text: 'Done.' }
    ])
    expect(textOf(parts)).toBe('Let me open Notepad.\n\nDone.')
  })

  it('marks failed calls and cuts long results and arguments for storage', () => {
    const failed = toolPart('t2', 'run_command', 'Llama Run', { command: 'x'.repeat(5000) })
    finishTool(failed, null, 'denied')
    expect(failed.status).toBe('error')
    expect(failed.result).toBe('Tool error: denied')
    expect(String(failed.args!.command).length).toBeLessThan(1100)
    const long = toolPart('t3', 'web_fetch', 'Llama Run', {})
    finishTool(long, { content: [{ type: 'text', text: 'y'.repeat(20_000) }] })
    expect(long.result!.length).toBeLessThan(4100)
    const errored = toolPart('t4', 'computer_click', 'Computer use', {})
    finishTool(errored, { content: [{ type: 'text', text: 'refused' }], isError: true })
    expect(errored.status).toBe('error')
  })

  it("puts a plugin's rewritten text after the tool calls", () => {
    const parts: MessagePart[] = [{ type: 'text', text: 'a' }, toolPart('t', 'x', 's', {}), { type: 'text', text: 'b' }]
    expect(replaceText(parts, 'rewritten').map((p) => p.type)).toEqual(['tool', 'text'])
  })

  it('joins rounds with a paragraph break, never mid-line', () => {
    expect(joinRound('Let me check.', 'Done.', true)).toBe('Let me check.\n\nDone.')
    expect(joinRound('Let me check.\n', 'Done.', true)).toBe('Let me check.\nDone.')
    expect(joinRound('', 'Done.', true)).toBe('Done.')
    expect(joinRound('Hel', 'lo', false)).toBe('Hello')
  })
})

describe('what later turns see of earlier tool calls', () => {
  const reply = (id: string, parts: MessagePart[]): ChatMessage => ({ id, role: 'assistant', content: textOf(parts), parts, status: 'done', createdAt: 0 })
  const used = (name: string, result: string): ToolPart => ({ type: 'tool', id: name, name, server: 's', args: { app: 'Notepad' }, status: 'done', result })

  it('keeps a short record of the tools the newest replies used', () => {
    const older = reply('a', [used('computer_open', 'Opened Notepad. Window 77'), { type: 'text', text: 'Opened it.' }])
    const recent1 = reply('b', [{ type: 'text', text: 'Typing.' }, used('computer_type', 'Typed')])
    const recent2 = reply('c', [used('computer_key', 'Saved')])
    const ids = recalledReplies([older, recent1, recent2])
    expect([...ids]).toEqual(['b', 'c'])
    expect(replyForModel(recent1, true)).toBe('Typing.\n[earlier tool call computer_type {"app":"Notepad"}: Typed]')
    expect(replyForModel(older, false)).toBe('Opened it.')
  })

  it('feeds that record into the history sent with the next message', () => {
    const user = (content: string): ChatMessage => ({ id: content, role: 'user', content, status: 'done', createdAt: 0 })
    const history = historyFor([user('open notepad'), reply('r', [used('computer_open', 'Opened Notepad. Window 77'), { type: 'text', text: 'Opened.' }]), user('now type hi')])
    expect(history[1]).toEqual({ role: 'assistant', content: '[earlier tool call computer_open {"app":"Notepad"}: Opened Notepad. Window 77]\nOpened.' })
  })
})

describe('running tool calls', () => {
  const bridge = (order: string[], sequential = false) => ({
    tools: [
      { name: 'a', server: 'one', description: '', inputSchema: {} },
      { name: 'b', server: 'two', description: '', inputSchema: {} }
    ],
    sequential: () => sequential,
    call: async (name: string) => {
      order.push(`start ${name}`)
      await new Promise((done) => setTimeout(done, name === 'a' ? 20 : 1))
      order.push(`end ${name}`)
      return { content: [{ type: 'text', text: name }] }
    }
  })

  it('runs independent calls together and returns results in the order asked', async () => {
    const order: string[] = []
    const started: string[] = []
    const out = await runToolCalls(bridge(order), [{ name: 'a', args: {} }, { name: 'b', args: {} }], { model: 'm', onTool: (c) => started.push(`${c.server}:${c.name}`) })
    expect(order).toEqual(['start a', 'start b', 'end b', 'end a'])
    expect(out.map((o) => o.call.name)).toEqual(['a', 'b'])
    expect(started).toEqual(['one:a', 'two:b'])
  })

  it('runs desktop actions one at a time', async () => {
    const order: string[] = []
    await runToolCalls(bridge(order, true), [{ name: 'a', args: {} }, { name: 'b', args: {} }], { model: 'm' })
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b'])
  })
})

describe('a chat reply with tools', () => {
  afterEach(() => vi.restoreAllMocks())

  it('streams text, tool cards and results in order, and saves them on the message', async () => {
    vi.spyOn(pluginHost, 'beforeTextGeneration').mockResolvedValue({ cancel: false, input_text: 'open notepad', model: '' } as never)
    vi.spyOn(pluginHost, 'afterTextGeneration').mockImplementation(async (_i, response) => ({ response_text: response }) as never)
    model.script = async (opts) => {
      const onToken = opts.onToken as (t: string) => void
      const onTool = opts.onTool as (c: { id: string; name: string; server: string; args: Record<string, unknown> }) => void
      const onToolResult = opts.onToolResult as (id: string, r: unknown) => void
      onToken('Opening it.')
      onTool({ id: 'call-1', name: 'computer_open', server: 'Computer use', args: { app: 'Notepad' } })
      onToolResult('call-1', { content: [{ type: 'text', text: 'Opened Notepad.' }] })
      onToken('Done.')
      return 'Opening it.\n\nDone.'
    }
    const events: ChatEvent[] = []
    const listener = (e: ChatEvent): void => void events.push(e)
    chatService.on('event', listener)
    const { done } = chatService.ask(null, 'open notepad', { model: 'm', ephemeral: true })
    const message = await done
    chatService.off('event', listener)

    expect(message.content).toBe('Opening it.\n\nDone.')
    expect(message.tools).toEqual([{ name: 'computer_open', server: 'Computer use' }])
    expect(message.parts).toEqual([
      { type: 'text', text: 'Opening it.' },
      { type: 'tool', id: 'call-1', name: 'computer_open', server: 'Computer use', args: { app: 'Notepad' }, status: 'done', result: 'Opened Notepad.' },
      { type: 'text', text: 'Done.' }
    ])
    // The window sees the text before the card, the card while it runs, then its result.
    const kinds = events.filter((e) => ['delta', 'tool', 'tool-done'].includes(e.type)).map((e) => (e.type === 'tool' ? `tool:${e.part?.status}` : e.type))
    expect(kinds.slice(0, 3)).toEqual(['delta', 'tool:running', 'tool-done'])
    expect(kinds.at(-1)).toBe('delta')
  })
})
