import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ApprovalRequest, SlashCommand } from '../src/shared/types'
import type { BotCommand, ChannelEvents, Sender } from '../src/main/channels/types'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-channels-'))
vi.mock('electron', () => ({
  app: { getPath: () => userData, isPackaged: false, getAppPath: () => '.' },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(`enc:${s}`), decryptString: (b: Buffer) => b.toString().slice(4) },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {}
}))

const { TelegramChannel } = await import('../src/main/channels/telegram')
const { DiscordChannel } = await import('../src/main/channels/discord')
const { chunks } = await import('../src/main/channels/types')
const { channelHub, menuCommands, BOT_COMMANDS } = await import('../src/main/channels')
const { approvals } = await import('../src/main/assistant/approval')

const request: ApprovalRequest = { id: 'ap1', title: 'Run this command on your computer?', command: 'pip install x', detail: 'In D:\\', alwaysLabel: 'Always allow pip *', chatLabel: 'Allow for this chat' }

describe('Telegram', () => {
  it('passes on private messages with the username, and button presses, ignoring groups', async () => {
    const calls: { method: string; body: Record<string, unknown> }[] = []
    const http = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: String(url).split('/').pop()!, body: JSON.parse(String(init?.body ?? '{}')) })
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }))
    }) as unknown as typeof fetch
    const tg = new TelegramChannel(http)
    const events = { message: vi.fn(), answer: vi.fn() }
    await tg.ask('42', request)
    const keyboard = calls[0].body.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }
    expect(keyboard.inline_keyboard.map((r) => r[0].text)).toEqual(['Allow once', 'Allow for this chat', 'Always allow pip *', 'Deny'])
    tg.handle(
      [
        { update_id: 5, message: { chat: { id: 42, type: 'private' }, from: { first_name: 'Krish', username: 'krish' }, text: 'hello' } },
        { update_id: 6, message: { chat: { id: -100, type: 'group' }, text: 'ignored' } },
        { update_id: 7, callback_query: { id: 'q', data: keyboard.inline_keyboard[3][0].callback_data } }
      ],
      events
    )
    expect(events.message).toHaveBeenCalledWith({ peer: '42', name: 'Krish', username: 'krish' }, 'hello')
    expect(events.message).toHaveBeenCalledTimes(1)
    expect(events.answer).toHaveBeenCalledWith('ap1', 'deny')
    // The / menu is set for that one chat, not for everyone who opens the bot.
    await tg.setCommands([{ command: 'new', description: 'x' }], '42')
    expect(calls.at(-1)).toEqual({ method: 'setMyCommands', body: { commands: [{ command: 'new', description: 'x' }], scope: { type: 'chat', chat_id: 42 } } })
  })

  it('splits long replies at line breaks', () => {
    expect(chunks(`${'a'.repeat(30)}\n${'b'.repeat(30)}`, 40)).toEqual(['a'.repeat(30), 'b'.repeat(30)])
  })
})

describe('Discord', () => {
  it('passes on direct messages only', () => {
    const dc = new DiscordChannel(vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch)
    const events = { message: vi.fn(), answer: vi.fn() }
    dc.dispatch({ op: 0, t: 'MESSAGE_CREATE', d: { channel_id: 'dm1', content: 'hi', author: { username: 'krish' } } }, events)
    dc.dispatch({ op: 0, t: 'MESSAGE_CREATE', d: { channel_id: 'g', guild_id: 'x', content: 'server msg', author: { username: 'k' } } }, events)
    dc.dispatch({ op: 0, t: 'MESSAGE_CREATE', d: { channel_id: 'dm1', content: 'echo', author: { username: 'bot', bot: true } } }, events)
    expect(events.message).toHaveBeenCalledTimes(1)
    expect(events.message).toHaveBeenCalledWith({ peer: 'dm1', name: 'krish', username: 'krish' }, 'hi')
  })
})

describe('the bot menu', () => {
  it('lists the bot commands, then skills and MCP prompts with names Telegram accepts', () => {
    const commands: SlashCommand[] = [
      { name: 'li-post', description: 'Write a LinkedIn post', kind: 'skill', plugin: 'Skill' },
      { name: 'github:review_pr', description: 'Review a PR', kind: 'mcp', plugin: 'MCP · GitHub' },
      { name: 'compact', description: 'built in', kind: 'builtin', plugin: 'Llama Run' }
    ]
    const menu = menuCommands(commands)
    expect(menu.slice(0, BOT_COMMANDS.length)).toEqual(BOT_COMMANDS)
    expect(menu.slice(BOT_COMMANDS.length).map((c) => c.command)).toEqual(['li_post', 'github_review_pr'])
  })
})

describe('the channel hub', () => {
  const me: Sender = { peer: '42', name: 'Krish', username: 'krish' }
  const sent: { peer: string; text: string }[] = []
  const asked: ApprovalRequest[] = []
  const menus: { peer: string; commands: BotCommand[] }[] = []
  let events: ChannelEvents | null = null
  const port = {
    ask: vi.fn(async (_chatId: string | undefined, text: string) => ({ chatId: 'chat-9', done: Promise.resolve({ status: 'done', content: `You said: ${text}` }) })),
    busy: vi.fn(() => false),
    queue: vi.fn(),
    stop: vi.fn(),
    compact: vi.fn(async () => undefined),
    usage: () => '1,000 tokens',
    model: (chatId: string | undefined) => (chatId ? 'gemini-chat' : 'gemini-default'),
    setModel: vi.fn(),
    models: async () => [
      { id: 'gemini-flash', name: 'Gemini Flash' },
      { id: 'gemini-pro', name: 'Gemini Pro' }
    ],
    commands: (): SlashCommand[] => [{ name: 'li-post', description: 'Write a post', kind: 'skill', plugin: 'Skill' }],
    requestNotice: vi.fn()
  }

  it('makes strangers wait for the user at the PC, and lets the user allow them', async () => {
    channelHub.factory = () => ({
      id: 'telegram',
      start: async (_t, e) => ((events = e), { botName: '@my_bot' }),
      stop: () => undefined,
      send: async (peer, text) => void sent.push({ peer, text }),
      ask: async (_p, r) => void asked.push(r),
      typing: async () => undefined,
      setCommands: async (commands, peer) => void menus.push({ peer, commands })
    })
    channelHub.start(port)
    const [status] = await channelHub.connect('telegram', '123:ABC')
    expect(status.connected).toBe(true)
    expect(JSON.parse(readFileSync(join(userData, 'channels.json'), 'utf8')).telegram.token).not.toContain('123:ABC')

    await channelHub.onMessage('telegram', me, 'hi')
    expect(port.ask).not.toHaveBeenCalled()
    expect(sent.at(-1)!.text).toContain('asked whether to let you in')
    expect(sent.at(-1)!.text).toContain('42')
    expect(port.requestNotice).toHaveBeenCalledWith('Telegram', 'Krish (@krish)')
    expect(channelHub.status()[0].pending).toMatchObject([{ peer: '42', name: 'Krish', username: 'krish', text: 'hi' }])
    // Writing again doesn't make another request or another reply.
    const count = sent.length
    await channelHub.onMessage('telegram', me, '/pair 123456')
    expect(sent.length).toBe(count)
    expect(channelHub.status()[0].pending).toHaveLength(1)

    await channelHub.approve('telegram', '42')
    expect(channelHub.status()[0].paired).toEqual([{ peer: '42', name: 'Krish', username: 'krish' }])
    expect(channelHub.status()[0].pending).toEqual([])
    expect(sent.at(-1)!.text).toContain("You're in")
    expect(menus.at(-1)!.peer).toBe('42')
    expect(menus.at(-1)!.commands.map((c) => c.command)).toContain('li_post')

    await channelHub.onMessage('telegram', me, 'what time is it')
    expect(port.ask).toHaveBeenCalledWith(undefined, 'what time is it', 'Telegram')
    expect(sent.at(-1)!.text).toBe('You said: what time is it')
    // A menu skill comes back as its /command.
    await channelHub.onMessage('telegram', me, '/li_post about launches')
    expect(port.ask).toHaveBeenLastCalledWith('chat-9', '/li-post about launches', 'Telegram')

    const pending = approvals.ask('chat-9', { title: 'Run?', command: 'x', detail: '', alwaysLabel: '' })
    await new Promise((r) => setTimeout(r, 0))
    expect(asked.map((a) => a.title)).toEqual(['Run?'])
    approvals.cancelChat('chat-9')
    await pending
    expect(events).not.toBeNull()
  })

  it('answers the bot commands without the model', async () => {
    port.ask.mockClear()
    await channelHub.onMessage('telegram', me, '/status')
    expect(sent.at(-1)!.text).toContain('Model: gemini-chat')
    await channelHub.onMessage('telegram', me, '/model')
    expect(sent.at(-1)!.text).toContain('2. Gemini Pro')
    await channelHub.onMessage('telegram', me, '/model 2')
    expect(port.setModel).toHaveBeenCalledWith('chat-9', 'gemini-pro')
    await channelHub.onMessage('telegram', me, '/usage')
    expect(sent.at(-1)!.text).toBe('1,000 tokens')
    port.busy.mockReturnValue(true)
    await channelHub.onMessage('telegram', me, '/stop')
    expect(port.stop).toHaveBeenCalledWith('chat-9')
    port.busy.mockReturnValue(false)
    await channelHub.onMessage('telegram', me, '/compact')
    expect(port.compact).toHaveBeenCalledWith('chat-9')
    await channelHub.onMessage('telegram', me, '/new')
    expect(sent.at(-1)!.text).toBe('Started a new chat.')
    expect(port.ask).not.toHaveBeenCalled()
  })

  it('ignores blocked people, and caps how many strangers can wait', async () => {
    channelHub.block('telegram', '42')
    const before = sent.length
    await channelHub.onMessage('telegram', me, 'let me in')
    expect(sent.length).toBe(before)
    expect(menus.at(-1)).toEqual({ peer: '42', commands: [] })
    expect(channelHub.status()[0].blocked).toMatchObject([{ peer: '42' }])
    for (let i = 0; i < 8; i++) await channelHub.onMessage('telegram', { peer: String(100 + i), name: `Stranger ${i}` }, 'hi')
    expect(channelHub.status()[0].pending).toHaveLength(5)
    expect(port.ask).not.toHaveBeenCalled()
    channelHub.unpair('telegram', '42')
    expect(channelHub.status()[0].blocked).toEqual([])
    channelHub.stop()
  })
})
