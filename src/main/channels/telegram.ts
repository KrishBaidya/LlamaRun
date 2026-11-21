import type { ApprovalAnswer, ApprovalRequest } from '@shared/types'
import { approvalButtons, approvalText, chunks, type BotCommand, type Channel, type ChannelEvents } from './types'

/**
 * Telegram through the user's own bot (made with @BotFather): long polling of
 * getUpdates, so nothing has to reach the PC from outside. Buttons carry
 * short keys that map back to approvals, since callback data is limited.
 */

const API = 'https://api.telegram.org'
const MAX_MESSAGE = 4000
const POLL_SECONDS = 50

interface Update {
  update_id: number
  message?: { chat: { id: number; type: string }; from?: { first_name?: string; username?: string }; text?: string }
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } }
}

export type Fetch = typeof fetch

export class TelegramChannel implements Channel {
  readonly id = 'telegram' as const
  private token = ''
  private offset = 0
  private running = false
  private controller: AbortController | null = null
  /** Button key -> what pressing it answers. */
  private buttons = new Map<string, { approvalId: string; answer: ApprovalAnswer | { text: string } }>()
  private keySeq = 0

  constructor(private readonly http: Fetch = (...a) => fetch(...a)) {}

  private async call<T>(method: string, body: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    const res = await this.http(`${API}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string }
    if (!data.ok) throw new Error(data.description || `Telegram ${method} failed (HTTP ${res.status})`)
    return data.result as T
  }

  async start(token: string, events: ChannelEvents): Promise<{ botName: string }> {
    this.token = token.trim()
    const me = await this.call<{ username?: string; first_name?: string }>('getMe')
    this.running = true
    void this.poll(events)
    return { botName: me.username ? `@${me.username}` : (me.first_name ?? 'your bot') }
  }

  stop(): void {
    this.running = false
    this.controller?.abort()
    this.controller = null
  }

  /** Handles one batch of updates (exported through poll; separate for tests). */
  handle(updates: Update[], events: ChannelEvents): void {
    for (const u of updates) {
      this.offset = Math.max(this.offset, u.update_id + 1)
      if (u.callback_query) {
        const pressed = u.callback_query.data ? this.buttons.get(u.callback_query.data) : undefined
        void this.call('answerCallbackQuery', { callback_query_id: u.callback_query.id, text: pressed ? 'Got it' : 'That question has ended' }).catch(() => {})
        if (pressed) {
          // One answer per approval: drop its other buttons.
          for (const [key, b] of this.buttons) if (b.approvalId === pressed.approvalId) this.buttons.delete(key)
          events.answer(pressed.approvalId, pressed.answer)
        }
        continue
      }
      const m = u.message
      // Direct messages only: a bot added to a group never acts on it.
      if (!m?.text || m.chat.type !== 'private') continue
      events.message({ peer: String(m.chat.id), name: m.from?.first_name ?? m.from?.username ?? 'Telegram', ...(m.from?.username ? { username: m.from.username } : {}) }, m.text)
    }
  }

  private async poll(events: ChannelEvents): Promise<void> {
    let failures = 0
    while (this.running) {
      this.controller = new AbortController()
      try {
        const updates = await this.call<Update[]>('getUpdates', { offset: this.offset, timeout: POLL_SECONDS, allowed_updates: ['message', 'callback_query'] }, this.controller.signal)
        failures = 0
        this.handle(updates, events)
      } catch {
        if (!this.running) return
        // Offline or Telegram hiccup: back off, up to a minute.
        failures++
        await new Promise((r) => setTimeout(r, Math.min(60_000, 2000 * 2 ** Math.min(failures, 5))))
      }
    }
  }

  async send(peer: string, text: string): Promise<void> {
    for (const piece of chunks(text, MAX_MESSAGE)) await this.call('sendMessage', { chat_id: peer, text: piece })
  }

  async ask(peer: string, request: ApprovalRequest): Promise<void> {
    const rows = approvalButtons(request).map((b) => {
      const key = `a${++this.keySeq}`
      this.buttons.set(key, { approvalId: request.id, answer: b.answer })
      return [{ text: b.label.slice(0, 60), callback_data: key }]
    })
    if (this.buttons.size > 500) this.buttons.delete(this.buttons.keys().next().value!)
    await this.call('sendMessage', { chat_id: peer, text: approvalText(request).slice(0, MAX_MESSAGE), reply_markup: { inline_keyboard: rows } })
  }

  async typing(peer: string): Promise<void> {
    await this.call('sendChatAction', { chat_id: peer, action: 'typing' }).catch(() => {})
  }

  /** The / menu for one chat only (Telegram's chat scope), so strangers who open the bot see none of it. */
  async setCommands(commands: BotCommand[], peer: string): Promise<void> {
    const scope = { type: 'chat', chat_id: Number(peer) }
    if (!commands.length) await this.call('deleteMyCommands', { scope })
    else await this.call('setMyCommands', { commands, scope })
  }
}
