import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import type { ApprovalAnswer, ApprovalRequest } from '@shared/types'
import { approvalButtons, approvalText, chunks, toTelegramHtml, type BotCommand, type Channel, type ChannelEvents, type IncomingFile } from './types'

/**
 * Telegram through the user's own bot (made with @BotFather): long polling of
 * getUpdates, so nothing has to reach the PC from outside. Replies stream by
 * editing one message, show formatted, and photos and files come in as
 * attachments. Buttons carry short keys that map back to what they answer,
 * since callback data is limited.
 */

const API = 'https://api.telegram.org'
const MAX_MESSAGE = 4000
const POLL_SECONDS = 50
/** Bots can download files up to 20 MB. */
const MAX_FILE_BYTES = 20 * 1024 * 1024

interface TgFile {
  file_id: string
  file_size?: number
}

interface Update {
  update_id: number
  message?: {
    message_id?: number
    chat: { id: number; type: string }
    from?: { first_name?: string; username?: string }
    text?: string
    caption?: string
    photo?: (TgFile & { width?: number })[]
    document?: TgFile & { file_name?: string; mime_type?: string }
  }
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } }
}

export type Fetch = typeof fetch

type Button = { kind: 'approval'; approvalId: string; answer: ApprovalAnswer | { text: string } } | { kind: 'choice'; peer: string; value: string; group: string }

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }

export class TelegramChannel implements Channel {
  readonly id = 'telegram' as const
  readonly personalMenus = true
  private token = ''
  private offset = 0
  private running = false
  private controller: AbortController | null = null
  /** Button key -> what pressing it answers. */
  private buttons = new Map<string, Button>()
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

  private key(button: Button): string {
    const key = `b${++this.keySeq}`
    this.buttons.set(key, button)
    if (this.buttons.size > 500) this.buttons.delete(this.buttons.keys().next().value!)
    return key
  }

  /** Handles one batch of updates (separate from poll for tests). */
  async handle(updates: Update[], events: ChannelEvents): Promise<void> {
    for (const u of updates) {
      this.offset = Math.max(this.offset, u.update_id + 1)
      if (u.callback_query) {
        const pressed = u.callback_query.data ? this.buttons.get(u.callback_query.data) : undefined
        void this.call('answerCallbackQuery', { callback_query_id: u.callback_query.id, text: pressed ? 'Got it' : 'That has ended' }).catch(() => {})
        if (!pressed) continue
        // One answer per question: drop its other buttons.
        for (const [key, b] of this.buttons) {
          if (pressed.kind === 'approval' && b.kind === 'approval' && b.approvalId === pressed.approvalId) this.buttons.delete(key)
          if (pressed.kind === 'choice' && b.kind === 'choice' && b.group === pressed.group) this.buttons.delete(key)
        }
        if (pressed.kind === 'approval') events.answer(pressed.approvalId, pressed.answer)
        else events.choice?.(pressed.peer, pressed.value)
        continue
      }
      const m = u.message
      // Direct messages only: a bot added to a group never acts on it.
      if (!m || m.chat.type !== 'private') continue
      const files = await this.filesOf(m).catch(() => [] as IncomingFile[])
      const text = m.text ?? m.caption ?? ''
      if (!text && !files.length) continue
      events.message(
        { peer: String(m.chat.id), name: m.from?.first_name ?? m.from?.username ?? 'Telegram', ...(m.from?.username ? { username: m.from.username } : {}) },
        text,
        { ...(m.message_id ? { messageId: String(m.message_id) } : {}), ...(files.length ? { files } : {}) }
      )
    }
  }

  /** The photo (largest size) or document in a message, downloaded. */
  private async filesOf(m: NonNullable<Update['message']>): Promise<IncomingFile[]> {
    if (m.photo?.length) {
      const best = m.photo[m.photo.length - 1]
      const bytes = await this.download(best)
      return bytes ? [{ kind: 'image', name: 'photo.jpg', mimeType: 'image/jpeg', bytes }] : []
    }
    if (m.document) {
      const bytes = await this.download(m.document)
      const mimeType = m.document.mime_type ?? 'application/octet-stream'
      const name = m.document.file_name ?? 'file'
      return bytes ? [{ kind: mimeType.startsWith('image/') ? 'image' : 'document', name, mimeType, bytes }] : []
    }
    return []
  }

  private async download(file: TgFile): Promise<Uint8Array | null> {
    if (file.file_size && file.file_size > MAX_FILE_BYTES) return null
    const info = await this.call<{ file_path?: string }>('getFile', { file_id: file.file_id })
    if (!info.file_path) return null
    const res = await this.http(`${API}/file/bot${this.token}/${info.file_path}`)
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  }

  private async poll(events: ChannelEvents): Promise<void> {
    let failures = 0
    while (this.running) {
      this.controller = new AbortController()
      try {
        const updates = await this.call<Update[]>('getUpdates', { offset: this.offset, timeout: POLL_SECONDS, allowed_updates: ['message', 'callback_query'] }, this.controller.signal)
        failures = 0
        await this.handle(updates, events)
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

  /** Formatted with Telegram's HTML; a piece Telegram can't parse goes as plain text. */
  async sendFormatted(peer: string, markdown: string): Promise<void> {
    for (const piece of chunks(markdown, 3500)) {
      try {
        await this.call('sendMessage', { chat_id: peer, text: toTelegramHtml(piece), parse_mode: 'HTML', link_preview_options: { is_disabled: true } })
      } catch {
        await this.call('sendMessage', { chat_id: peer, text: piece })
      }
    }
  }

  async draft(peer: string, text: string): Promise<string> {
    const sent = await this.call<{ message_id: number }>('sendMessage', { chat_id: peer, text: text.slice(0, MAX_MESSAGE) })
    return String(sent.message_id)
  }

  async edit(peer: string, messageId: string, text: string, final: boolean): Promise<void> {
    const body = { chat_id: peer, message_id: Number(messageId) }
    try {
      if (final) await this.call('editMessageText', { ...body, text: toTelegramHtml(text), parse_mode: 'HTML', link_preview_options: { is_disabled: true } })
      else await this.call('editMessageText', { ...body, text: text.slice(0, MAX_MESSAGE) })
    } catch (err) {
      // "message is not modified" is fine; a formatting problem falls back to plain text.
      if (/not modified/i.test((err as Error).message)) return
      if (final) await this.call('editMessageText', { ...body, text: text.slice(0, MAX_MESSAGE) }).catch(() => {})
    }
  }

  async remove(peer: string, messageId: string): Promise<void> {
    await this.call('deleteMessage', { chat_id: peer, message_id: Number(messageId) }).catch(() => {})
  }

  async sendImage(peer: string, path: string, caption?: string): Promise<void> {
    const type = IMAGE_TYPES[extname(path).toLowerCase()]
    if (!type) return
    const form = new FormData()
    form.append('chat_id', peer)
    if (caption) form.append('caption', caption.slice(0, 1000))
    form.append('photo', new Blob([new Uint8Array(readFileSync(path))], { type }), basename(path))
    const res = await this.http(`${API}/bot${this.token}/sendPhoto`, { method: 'POST', body: form })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string }
    if (!data.ok) throw new Error(data.description || 'Telegram sendPhoto failed')
  }

  async react(peer: string, messageId: string, emoji: string): Promise<void> {
    await this.call('setMessageReaction', { chat_id: peer, message_id: Number(messageId), reaction: [{ type: 'emoji', emoji }] }).catch(() => {})
  }

  async ask(peer: string, request: ApprovalRequest): Promise<void> {
    const rows = approvalButtons(request).map((b) => [{ text: b.label.slice(0, 60), callback_data: this.key({ kind: 'approval', approvalId: request.id, answer: b.answer }) }])
    await this.call('sendMessage', { chat_id: peer, text: approvalText(request).slice(0, MAX_MESSAGE), reply_markup: { inline_keyboard: rows } })
  }

  async choose(peer: string, text: string, options: { label: string; value: string }[]): Promise<void> {
    const group = `g${++this.keySeq}`
    const rows = options.slice(0, 40).map((o) => [{ text: o.label.slice(0, 60), callback_data: this.key({ kind: 'choice', peer, value: o.value, group }) }])
    await this.call('sendMessage', { chat_id: peer, text, reply_markup: { inline_keyboard: rows } })
  }

  async typing(peer: string): Promise<void> {
    await this.call('sendChatAction', { chat_id: peer, action: 'typing' }).catch(() => {})
  }

  /**
   * The / menu for one chat (Telegram's chat scope), or everyone's default
   * menu when peer is null. For a chat, its menu button is set to show the
   * commands (a bot set up with a web app button would hide them otherwise),
   * and Telegram is asked what it now has, so a silent refusal shows.
   */
  async setCommands(commands: BotCommand[], peer: string | null): Promise<number> {
    const scope = peer === null ? { type: 'default' } : { type: 'chat', chat_id: Number(peer) }
    if (!commands.length) {
      await this.call('deleteMyCommands', { scope })
      return 0
    }
    await this.call('setMyCommands', { commands, scope })
    if (peer !== null) await this.call('setChatMenuButton', { chat_id: Number(peer), menu_button: { type: 'commands' } }).catch(() => {})
    const now = await this.call<BotCommand[]>('getMyCommands', { scope })
    return now.length
  }

  async setProfile(description: string, short: string): Promise<void> {
    await this.call('setMyDescription', { description: description.slice(0, 512) })
    await this.call('setMyShortDescription', { short_description: short.slice(0, 120) })
  }
}
