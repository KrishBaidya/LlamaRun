import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ApprovalRequest } from '../src/shared/types'

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
const { channelHub } = await import('../src/main/channels')
const { approvals } = await import('../src/main/assistant/approval')

const request: ApprovalRequest = { id: 'ap1', title: 'Run this command on your computer?', command: 'pip install x', detail: 'In D:\\', alwaysLabel: 'Always allow pip *', chatLabel: 'Allow for this chat' }

describe('Telegram', () => {
  it('passes on private messages and button presses, ignoring groups', async () => {
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
        { update_id: 5, message: { chat: { id: 42, type: 'private' }, from: { first_name: 'Krish' }, text: 'hello' } },
        { update_id: 6, message: { chat: { id: -100, type: 'group' }, text: 'ignored' } },
        { update_id: 7, callback_query: { id: 'q', data: keyboard.inline_keyboard[3][0].callback_data } }
      ],
      events
    )
    expect(events.message).toHaveBeenCalledWith('42', 'Krish', 'hello')
    expect(events.message).toHaveBeenCalledTimes(1)
    expect(events.answer).toHaveBeenCalledWith('ap1', 'deny')
  })

  it('splits long replies at line breaks', () => {
    const parts = chunks(`${'a'.repeat(30)}\n${'b'.repeat(30)}`, 40)
    expect(parts).toEqual(['a'.repeat(30), 'b'.repeat(30)])
  })
})

describe('Discord', () => {
  it('passes on direct messages only and answers button presses', () => {
    const http = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch
    const dc = new DiscordChannel(http)
    const events = { message: vi.fn(), answer: vi.fn() }
    dc.dispatch({ op: 0, t: 'MESSAGE_CREATE', d: { channel_id: 'dm1', content: 'hi', author: { username: 'krish' } } }, events)
    dc.dispatch({ op: 0, t: 'MESSAGE_CREATE', d: { channel_id: 'g', guild_id: 'x', content: 'server msg', author: { username: 'k' } } }, events)
    dc.dispatch({ op: 0, t: 'MESSAGE_CREATE', d: { channel_id: 'dm1', content: 'echo', author: { username: 'bot', bot: true } } }, events)
    expect(events.message).toHaveBeenCalledTimes(1)
    expect(events.message).toHaveBeenCalledWith('dm1', 'krish', 'hi')
  })
})

describe('the channel hub', () => {
  it('pairs with the code, refuses strangers, runs messages in the peer’s chat and sends approvals there', async () => {
    const sent: string[] = []
    const asked: ApprovalRequest[] = []
    let onEvents: { message: (p: string, n: string, t: string) => void } | null = null
    channelHub.factory = () => ({
      id: 'telegram',
      start: async (_t, events) => ((onEvents = events), { botName: '@my_bot' }),
      stop: () => undefined,
      send: async (_p, text) => void sent.push(text),
      ask: async (_p, r) => void asked.push(r),
      typing: async () => undefined
    })
    const port = {
      ask: vi.fn((_chatId: string | undefined, text: string) => ({ chatId: 'chat-9', done: Promise.resolve({ status: 'done', content: `You said: ${text}` }) })),
      busy: () => false,
      queue: vi.fn()
    }
    channelHub.start(port)
    const [status] = await channelHub.connect('telegram', '123:ABC')
    expect(status.connected).toBe(true)
    expect(JSON.parse(readFileSync(join(userData, 'channels.json'), 'utf8')).telegram.token).not.toContain('123:ABC')

    await channelHub.onMessage('telegram', '7', 'Stranger', 'hi')
    expect(sent.at(-1)).toContain("belongs to someone's Llama Run")
    expect(port.ask).not.toHaveBeenCalled()

    await channelHub.onMessage('telegram', '42', 'Krish', `/pair ${status.pairCode}`)
    expect(sent.at(-1)).toContain('Paired with Llama Run')
    await channelHub.onMessage('telegram', '42', 'Krish', 'what time is it')
    expect(port.ask).toHaveBeenCalledWith(undefined, 'what time is it', 'Telegram')
    expect(sent.at(-1)).toBe('You said: what time is it')

    const pending = approvals.ask('chat-9', { title: 'Run?', command: 'x', detail: '', alwaysLabel: '' })
    await new Promise((r) => setTimeout(r, 0))
    expect(asked.map((a) => a.title)).toEqual(['Run?'])
    approvals.cancelChat('chat-9')
    await pending
    expect(onEvents).not.toBeNull()
    channelHub.stop()
  })
})
