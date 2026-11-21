import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ApprovalRequest, SlashCommand } from '../src/shared/types'
import type { BotCommand, ChannelEvents, Sender } from '../src/main/channels/types'
import type { ChatEvent } from '../src/shared/types'

const userData = mkdtempSync(join(tmpdir(), 'llamarun-channels-'))
vi.mock('electron', () => ({
  app: { getPath: () => userData, isPackaged: false, getAppPath: () => '.' },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(`enc:${s}`), decryptString: (b: Buffer) => b.toString().slice(4) },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {}
}))

const { TelegramChannel } = await import('../src/main/channels/telegram')
const { DiscordChannel } = await import('../src/main/channels/discord')
const { chunks, toTelegramHtml } = await import('../src/main/channels/types')
const { channelHub, menuCommands, menuAttempts, BOT_COMMANDS } = await import('../src/main/channels')
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
    await tg.handle(
      [
        { update_id: 5, message: { chat: { id: 42, type: 'private' }, from: { first_name: 'Krish', username: 'krish' }, text: 'hello' } },
        { update_id: 6, message: { chat: { id: -100, type: 'group' }, text: 'ignored' } },
        { update_id: 7, callback_query: { id: 'q', data: keyboard.inline_keyboard[3][0].callback_data } }
      ],
      events
    )
    expect(events.message).toHaveBeenCalledWith({ peer: '42', name: 'Krish', username: 'krish' }, 'hello', {})
    expect(events.message).toHaveBeenCalledTimes(1)
    expect(events.answer).toHaveBeenCalledWith('ap1', 'deny')
    // The / menu is set for that one chat, not for everyone who opens the bot.
    await tg.setCommands([{ command: 'new', description: 'x' }], '42')
    expect(calls.find((c) => c.method === 'setMyCommands')).toEqual({ method: 'setMyCommands', body: { commands: [{ command: 'new', description: 'x' }], scope: { type: 'chat', chat_id: 42 } } })
    // The chat's menu button shows the commands, and Telegram is asked what it now has.
    expect(calls.map((c) => c.method).slice(-2)).toEqual(['setChatMenuButton', 'getMyCommands'])
    await tg.setCommands([{ command: 'help', description: 'x' }], null)
    expect(calls.filter((c) => c.method === 'setMyCommands').at(-1)!.body.scope).toEqual({ type: 'default' })
  })

  it('downloads a photo sent with a caption', async () => {
    const http = vi.fn(async (url: string) => {
      if (String(url).endsWith('/getFile')) return new Response(JSON.stringify({ ok: true, result: { file_path: 'photos/1.jpg' } }))
      if (String(url).includes('/file/bot')) return new Response(new Uint8Array([1, 2, 3]))
      return new Response(JSON.stringify({ ok: true, result: true }))
    }) as unknown as typeof fetch
    const tg = new TelegramChannel(http)
    const events = { message: vi.fn(), answer: vi.fn() }
    await tg.handle([{ update_id: 1, message: { message_id: 9, chat: { id: 42, type: 'private' }, from: { first_name: 'K' }, caption: 'what is this', photo: [{ file_id: 'small' }, { file_id: 'big' }] } }], events)
    const [, text, extra] = events.message.mock.calls[0]
    expect(text).toBe('what is this')
    expect(extra.messageId).toBe('9')
    expect(extra.files[0]).toMatchObject({ kind: 'image', mimeType: 'image/jpeg' })
    expect([...extra.files[0].bytes]).toEqual([1, 2, 3])
  })

  it("formats the model's Markdown as Telegram HTML, escaping the rest", () => {
    expect(toTelegramHtml('**Total** is `5 < 6` & [docs](https://x.dev/a?b=1)\n- one\n```py\nprint("<hi>")\n```')).toBe(
      '<b>Total</b> is <code>5 &lt; 6</code> &amp; <a href="https://x.dev/a?b=1">docs</a>\n• one\n<pre><code>print("&lt;hi&gt;")</code></pre>'
    )
  })

  it('splits long replies at line breaks', () => {
    expect(chunks(`${'a'.repeat(30)}\n${'b'.repeat(30)}`, 40)).toEqual(['a'.repeat(30), 'b'.repeat(30)])
  })
})

describe('Discord', () => {
  const calls: { method: string; path: string; body: unknown }[] = []
  const http = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace('https://discord.com/api/v10', '')
    if (String(url).startsWith('https://cdn.discordapp.com')) return new Response(new Uint8Array([7, 8]))
    calls.push({ method: init?.method ?? 'GET', path, body: init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined })
    if (path === '/applications/@me') return new Response(JSON.stringify({ id: 'app1' }))
    if (path.endsWith('/commands')) return new Response(JSON.stringify([1, 2, 3]))
    if (path.endsWith('/messages') && init?.method === 'POST') return new Response(JSON.stringify({ id: 'msg1' }))
    return new Response(null, { status: 204 })
  }) as unknown as typeof fetch

  it('passes on direct messages with their files, ignoring servers and bots', async () => {
    const dc = new DiscordChannel(http)
    const events = { message: vi.fn(), answer: vi.fn() }
    await dc.dispatch({ op: 0, t: 'MESSAGE_CREATE', d: { id: 'm1', channel_id: 'dm1', content: 'hi', author: { username: 'krish' } } }, events)
    await dc.dispatch({ op: 0, t: 'MESSAGE_CREATE', d: { channel_id: 'g', guild_id: 'x', content: 'server msg', author: { username: 'k' } } }, events)
    await dc.dispatch({ op: 0, t: 'MESSAGE_CREATE', d: { channel_id: 'dm1', content: 'echo', author: { username: 'bot', bot: true } } }, events)
    await dc.dispatch({ op: 0, t: 'MESSAGE_CREATE', d: { id: 'm2', channel_id: 'dm1', content: '', author: { username: 'krish' }, attachments: [{ url: 'https://cdn.discordapp.com/a.png', filename: 'a.png', content_type: 'image/png', size: 2 }] } }, events)
    expect(events.message).toHaveBeenCalledTimes(2)
    expect(events.message).toHaveBeenNthCalledWith(1, { peer: 'dm1', name: 'krish', username: 'krish' }, 'hi', { messageId: 'm1' })
    expect(events.message.mock.calls[1][2].files[0]).toMatchObject({ kind: 'image', name: 'a.png' })
  })

  it('turns slash commands into messages and suggests only what the hub allows', async () => {
    const dc = new DiscordChannel(http)
    const complete = vi.fn(async () => [{ name: '/li-post · Skill', value: '/li-post' }])
    const events = { message: vi.fn(), answer: vi.fn(), complete }
    await dc.dispatch({ op: 0, t: 'INTERACTION_CREATE', d: { id: 'i1', token: 't', type: 2, channel_id: 'dm1', user: { username: 'krish' }, data: { name: 'run', options: [{ name: 'command', value: '/li-post' }, { name: 'text', value: 'about launches' }] } } }, events)
    expect(events.message).toHaveBeenCalledWith({ peer: 'dm1', name: 'krish', username: 'krish' }, '/li-post about launches')
    expect(calls.at(-1)).toMatchObject({ path: '/interactions/i1/t/callback', body: { type: 4 } })
    await dc.dispatch({ op: 0, t: 'INTERACTION_CREATE', d: { id: 'i2', token: 't', type: 4, channel_id: 'dm1', user: { username: 'krish' }, data: { name: 'run', options: [{ name: 'command', value: 'li', focused: true }] } } }, events)
    expect(complete).toHaveBeenCalledWith('dm1', 'command', 'li')
    expect(calls.at(-1)!.body).toEqual({ type: 8, data: { choices: [{ name: '/li-post · Skill', value: '/li-post' }] } })
  })

  it('registers the bot commands plus /run as direct-message slash commands', async () => {
    const dc = new DiscordChannel(http)
    await dc.setCommands([{ command: 'new', description: 'Start a fresh chat' }, { command: 'model', description: 'Model' }], null)
    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.path).toBe('/applications/app1/commands')
    expect((put.body as { name: string }[]).map((c) => c.name)).toEqual(['new', 'model', 'run'])
    expect(await dc.setCommands([], '42')).toBeUndefined()
  })
})

describe('the bot menu', () => {
  it('lists the bot commands, then skills and MCP prompts with names Telegram accepts', () => {
    const commands: SlashCommand[] = [
      { name: 'li-post', description: 'Write a LinkedIn post', kind: 'skill', plugin: 'Skill' },
      { name: 'github:review_pr', description: 'Review a PR', kind: 'mcp', plugin: 'MCP · GitHub' },
      { name: 'compact', description: 'built in', kind: 'builtin', plugin: 'Llama Run' },
      { name: 'jira-today', description: 'Tickets due today', kind: 'plugin', plugin: 'Jira' }
    ]
    const menu = menuCommands(commands)
    expect(menu.slice(0, BOT_COMMANDS.length)).toEqual(BOT_COMMANDS)
    // Plugin commands first, then MCP prompts, then skills; desktop-only built-ins stay out.
    expect(menu.slice(BOT_COMMANDS.length).map((c) => c.command)).toEqual(['jira_today', 'github_review_pr', 'li_post'])
  })

  it('folds skill packs into one entry, and has smaller versions for when Telegram says it is too much', () => {
    const skill = (name: string): SlashCommand => ({ name, description: `${name} does a long and detailed thing for you`, kind: 'skill', plugin: 'Skill' })
    const menu = menuCommands(['li-post', 'li-dm', 'seo', 'seo-audit', 'humanizer'].map(skill))
    expect(menu.slice(BOT_COMMANDS.length)).toEqual([
      { command: 'li', description: '2 skills: li-post, li-dm' },
      { command: 'seo', description: '2 skills: seo, seo-audit' },
      { command: 'humanizer', description: 'humanizer does a long and detailed thing for you' }
    ])
    const attempts = menuAttempts(menu)
    expect(attempts[0]).toBe(menu)
    expect(attempts.at(-1)!.length).toBeLessThanOrEqual(25)
    expect(Math.max(...attempts[1].map((c) => c.description.length))).toBeLessThanOrEqual(30)
  })
})

describe('the channel hub', () => {
  const me: Sender = { peer: '42', name: 'Krish', username: 'krish' }
  const sent: { peer: string; text: string }[] = []
  const asked: ApprovalRequest[] = []
  const menus: { peer: string | null; commands: BotCommand[] }[] = []
  const edits: { id: string; text: string; final: boolean }[] = []
  const images: string[] = []
  const choices: { text: string; options: { label: string; value: string }[] }[] = []
  let chatEvents: ((e: ChatEvent) => void) | null = null
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
    commands: (): SlashCommand[] => [
      { name: 'li-post', description: 'Write a post', kind: 'skill', plugin: 'Skill' },
      { name: 'jira-today', description: 'Tickets due today', kind: 'plugin', plugin: 'Jira' }
    ],
    pluginCommand: vi.fn(async (chatId: string | undefined, text: string) => (text.startsWith('/jira-today') ? { chatId: chatId ?? 'chat-9', reply: '**3** tickets due' } : null)),
    tools: () => [
      { name: 'read_file', server: 'Llama Run' },
      { name: 'create_issue', server: 'GitHub' }
    ],
    requestNotice: vi.fn(),
    watch: (_chatId: string, listener: (e: ChatEvent) => void) => ((chatEvents = listener), () => (chatEvents = null)),
    attach: vi.fn(async (file: { kind: 'image' | 'document'; name: string }) => ({ id: 'a1', kind: file.kind, name: file.name, mimeType: 'image/jpeg', size: 3 }))
  }

  it('makes strangers wait for the user at the PC, and lets the user allow them', async () => {
    channelHub.factory = () => ({
      id: 'telegram',
      personalMenus: true,
      start: async (_t, e) => ((events = e), { botName: '@my_bot' }),
      stop: () => undefined,
      send: async (peer, text) => void sent.push({ peer, text }),
      ask: async (_p, r) => void asked.push(r),
      typing: async () => undefined,
      setCommands: async (commands, peer) => void menus.push({ peer, commands }),
      draft: async (_peer, text) => (edits.push({ id: `m${edits.length}`, text, final: false }), `m${edits.length - 1}`),
      edit: async (_peer, id, text, final) => void edits.push({ id, text, final }),
      remove: async () => undefined,
      sendImage: async (_peer, path) => void images.push(path),
      choose: async (_peer, text, options) => void choices.push({ text, options })
    })
    channelHub.start(port)
    const [status] = await channelHub.connect('telegram', '123:ABC')
    expect(status.connected).toBe(true)
    // Everyone gets the bot's own commands; nobody's skills yet.
    await new Promise((r) => setTimeout(r, 0))
    expect(menus.find((m) => m.peer === null)?.commands.map((c) => c.command)).toEqual(BOT_COMMANDS.map((c) => c.command))
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
    expect(port.ask).toHaveBeenCalledWith(undefined, 'what time is it', 'Telegram', {})
    // Nothing streamed, so the reply goes as its own message.
    expect(sent.at(-1)!.text).toBe('You said: what time is it')
    // A menu skill comes back as its /command.
    await channelHub.onMessage('telegram', me, '/li_post about launches')
    expect(port.ask).toHaveBeenLastCalledWith('chat-9', '/li-post about launches', 'Telegram', {})

    const pending = approvals.ask('chat-9', { title: 'Run?', command: 'x', detail: '', alwaysLabel: '' })
    await new Promise((r) => setTimeout(r, 0))
    expect(asked.map((a) => a.title)).toEqual(['Run?'])
    approvals.cancelChat('chat-9')
    await pending
    expect(events).not.toBeNull()
  })

  it('streams a reply into one message, says which tool runs, and sends images the model made', async () => {
    let finish: (d: { status: string; content: string }) => void = () => {}
    port.ask.mockImplementationOnce(async () => ({ chatId: 'chat-9', done: new Promise((r) => (finish = r)) }))
    edits.length = 0
    const run = channelHub.onMessage('telegram', me, 'draw a cat', { messageId: '5' })
    await new Promise((r) => setTimeout(r, 10))
    chatEvents!({ type: 'delta', chatId: 'chat-9', messageId: 'x', text: 'Drawing ' })
    chatEvents!({ type: 'tool', chatId: 'chat-9', messageId: 'x', tool: { id: 't', name: 'image_generate', server: 'Llama Run', args: {} } } as ChatEvent)
    await new Promise((r) => setTimeout(r, 400))
    expect(edits[0].text).toContain('Drawing')
    expect(edits[0].text).toContain('Using image_generate')
    chatEvents!({ type: 'tool-done', chatId: 'chat-9', messageId: 'x', part: { type: 'tool', id: 't', name: 'image_generate', server: 'Llama Run', args: {}, status: 'done', result: 'Saved C:\\pics\\cat.png (the model said: meow)' } })
    finish({ status: 'done', content: '**Here** is your cat.' })
    await run
    expect(edits.at(-1)).toEqual({ id: 'm0', text: '**Here** is your cat.', final: true })
    expect(images).toEqual(['C:\\pics\\cat.png'])
  })

  it('reads photos and files someone sends', async () => {
    await channelHub.onMessage('telegram', me, '', { files: [{ kind: 'image', name: 'photo.jpg', mimeType: 'image/jpeg', bytes: new Uint8Array([1]) }] })
    expect(port.ask).toHaveBeenLastCalledWith('chat-9', 'What do you see in this?', 'Telegram', { attachments: [expect.objectContaining({ kind: 'image' })] })
  })

  it('answers the bot commands without the model', async () => {
    port.ask.mockClear()
    await channelHub.onMessage('telegram', me, '/status')
    expect(sent.at(-1)!.text).toContain('Model: gemini-chat')
    // /model shows buttons; pressing one switches the chat.
    await channelHub.onMessage('telegram', me, '/model')
    expect(choices.at(-1)!.options.map((o) => o.value)).toEqual(['model:gemini-flash', 'model:gemini-pro'])
    events!.choice!('42', 'model:gemini-pro')
    await new Promise((r) => setTimeout(r, 0))
    expect(port.setModel).toHaveBeenCalledWith('chat-9', 'gemini-pro')
    await channelHub.onMessage('telegram', me, '/model flash')
    expect(port.setModel).toHaveBeenLastCalledWith('chat-9', 'gemini-flash')
    await channelHub.onMessage('telegram', me, '/tools')
    expect(sent.at(-1)!.text).toBe('Llama Run (1):\nread_file\n\nGitHub (1):\ncreate_issue')
    // A plugin's command from the menu runs through the plugin and its reply comes back.
    await channelHub.onMessage('telegram', me, '/jira_today')
    expect(port.pluginCommand).toHaveBeenLastCalledWith('chat-9', '/jira-today')
    expect(sent.at(-1)!.text).toBe('**3** tickets due')
    expect(channelHub.status()[0].menu).toContain('commands for Krish')
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

  it('suggests models and commands to allowed people only', async () => {
    expect(await channelHub.complete('telegram', '42', 'command', 'li')).toEqual([{ name: '/li-post · Skill: Write a post', value: '/li-post' }])
    expect((await channelHub.complete('telegram', '42', 'name', 'pro')).map((c) => c.value)).toEqual(['gemini-pro'])
    expect(await channelHub.complete('telegram', 'stranger', 'command', '')).toEqual([])
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
