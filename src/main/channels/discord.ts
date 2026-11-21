import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { ApprovalAnswer, ApprovalRequest } from '@shared/types'
import { approvalButtons, approvalText, chunks, type BotCommand, type Channel, type ChannelEvents, type IncomingFile } from './types'

/**
 * Discord through the user's own bot application: direct messages over the
 * Gateway (a WebSocket the PC opens, so nothing reaches in), replies, button
 * presses and slash commands over the REST API. Replies stream by editing one
 * message; Discord shows Markdown itself. Slash commands list the bot's own
 * commands, each skill, MCP prompt and plugin command, and each skill pack as
 * one command whose skill option suggests its skills (Discord has one list for
 * everyone; only allowed people can run anything or get suggestions). A slash command
 * used in a server answers privately and carries on in the person's direct
 * messages, so nothing of the chat shows in the server. Needs the Message
 * Content intent turned on for the bot in the Developer Portal.
 */

const API = 'https://discord.com/api/v10'
const MAX_MESSAGE = 1900
/** DIRECT_MESSAGES | MESSAGE_CONTENT */
const INTENTS = (1 << 12) | (1 << 15)
const MAX_FILE_BYTES = 20 * 1024 * 1024

interface Dispatch {
  op: number
  t?: string
  s?: number | null
  d?: Record<string, unknown> & { heartbeat_interval?: number }
}

interface Author {
  bot?: boolean
  username?: string
  global_name?: string
}

type Button = { kind: 'approval'; approvalId: string; answer: ApprovalAnswer | { text: string } } | { kind: 'choice'; peer: string; value: string; group: string }

/** Discord's interaction types and option type for text. */
const COMMAND = 2
const COMPONENT = 3
const AUTOCOMPLETE = 4
const TEXT_OPTION = 3

export class DiscordChannel implements Channel {
  readonly id = 'discord' as const
  readonly maxMessage = MAX_MESSAGE
  private token = ''
  private socket: WebSocket | null = null
  private heartbeat: NodeJS.Timeout | null = null
  private seq: number | null = null
  private running = false
  private failures = 0
  private buttons = new Map<string, Button>()
  private keySeq = 0
  private appId = ''
  private botId = ''
  /** Discord user id -> their direct-message channel with the bot. */
  private dms = new Map<string, string>()

  constructor(private readonly http: typeof fetch = (...a) => fetch(...a)) {}

  private async rest<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.http(`${API}${path}`, {
      method,
      headers: { Authorization: `Bot ${this.token}`, 'Content-Type': 'application/json', 'User-Agent': 'DiscordBot (https://llamarun.app, 1)' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    if (res.status === 204) return undefined as T
    const data = (await res.json().catch(() => ({}))) as T & { message?: string }
    if (!res.ok) throw new Error((data as { message?: string }).message || `Discord ${path} failed (HTTP ${res.status})`)
    return data
  }

  async start(token: string, events: ChannelEvents): Promise<{ botName: string }> {
    this.token = token.trim()
    const me = await this.rest<{ username: string; id?: string }>('GET', '/users/@me')
    this.botId = me.id ?? ''
    this.appId = (await this.rest<{ id?: string }>('GET', '/applications/@me').catch(() => ({ id: '' }))).id ?? ''
    this.running = true
    await this.connect(events)
    return { botName: me.username }
  }

  private async connect(events: ChannelEvents): Promise<void> {
    const { url } = await this.rest<{ url: string }>('GET', '/gateway/bot')
    const socket = new WebSocket(`${url}?v=10&encoding=json`)
    this.socket = socket
    socket.onmessage = (e) => {
      let msg: Dispatch
      try {
        msg = JSON.parse(String(e.data)) as Dispatch
      } catch {
        return
      }
      if (typeof msg.s === 'number') this.seq = msg.s
      if (msg.op === 10 && msg.d?.heartbeat_interval) {
        this.beat(msg.d.heartbeat_interval)
        socket.send(JSON.stringify({ op: 2, d: { token: this.token, intents: INTENTS, properties: { os: 'windows', browser: 'llamarun', device: 'llamarun' } } }))
      } else if (msg.op === 1) socket.send(JSON.stringify({ op: 1, d: this.seq }))
      else if (msg.op === 0) {
        if (msg.t === 'READY') this.failures = 0
        void this.dispatch(msg, events)
      }
    }
    socket.onclose = () => {
      if (this.heartbeat) clearInterval(this.heartbeat)
      this.heartbeat = null
      if (!this.running) return
      this.failures++
      setTimeout(() => void this.connect(events).catch(() => {}), Math.min(60_000, 2000 * 2 ** Math.min(this.failures, 5)))
    }
  }

  private beat(interval: number): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = setInterval(() => this.socket?.send(JSON.stringify({ op: 1, d: this.seq })), interval)
  }

  private callback(d: Record<string, unknown>, body: unknown): Promise<unknown> {
    return this.rest('POST', `/interactions/${String(d.id)}/${String(d.token)}/callback`, body).catch(() => {})
  }

  /** Handles a Gateway event (separate for tests). */
  async dispatch(msg: Dispatch, events: ChannelEvents): Promise<void> {
    const d = msg.d ?? {}
    if (msg.t === 'MESSAGE_CREATE') {
      const author = d.author as Author | undefined
      // Direct messages only (no guild), never from bots.
      if (d.guild_id || author?.bot) return
      const files = await this.filesOf(d.attachments).catch(() => [] as IncomingFile[])
      const text = typeof d.content === 'string' ? d.content : ''
      if (!text.trim() && !files.length) return
      events.message(this.sender(String(d.channel_id), author), text, { ...(d.id ? { messageId: String(d.id) } : {}), ...(files.length ? { files } : {}) })
      return
    }
    if (msg.t !== 'INTERACTION_CREATE') return
    const user = ((d.user ?? (d.member as { user?: Author & { id?: string } } | undefined)?.user) as (Author & { id?: string }) | undefined) ?? undefined
    // In a server, the conversation happens in the person's direct messages with the bot.
    const inServer = Boolean(d.guild_id)
    const peer = inServer ? (user?.id ? await this.dmWith(user.id).catch(() => '') : '') : String(d.channel_id)
    if (!peer) return void (await this.callback(d, { type: 4, data: { content: "I couldn't open a direct message with you. Check that your privacy settings allow messages from this server.", flags: 64 } }))
    const data = (d.data ?? {}) as { custom_id?: string; name?: string; options?: { name: string; value: unknown; focused?: boolean }[] }
    if (d.type === AUTOCOMPLETE) {
      const focused = data.options?.find((o) => o.focused)
      // A pack's skill option is completed from that pack.
      const option = focused?.name === 'skill' ? `skill:${String(data.name)}` : (focused?.name ?? '')
      const choices = focused && events.complete ? await events.complete(peer, option, String(focused.value ?? '')).catch(() => []) : []
      await this.callback(d, { type: 8, data: { choices: choices.slice(0, 25).map((c) => ({ name: c.name.slice(0, 100), value: c.value.slice(0, 100) })) } })
      return
    }
    if (d.type === COMMAND) {
      const opt = (name: string): string => String(data.options?.find((o) => o.name === name)?.value ?? '').trim()
      // A pack runs the skill picked in its option; everything else is its own /command, with its words after it.
      const command = opt('skill') ? `/${opt('skill')}` : `/${data.name}`
      const text = [command, opt('name'), opt('text')].filter(Boolean).join(' ')
      if (inServer) await this.callback(d, { type: 4, data: { content: `Answering in our direct messages: https://discord.com/channels/@me/${peer}`, flags: 64 } })
      else await this.callback(d, { type: 4, data: { content: `> ${text}`.slice(0, 2000) } })
      if (inServer) await this.rest('POST', `/channels/${peer}/messages`, { content: `> ${text}`.slice(0, 2000), allowed_mentions: { parse: [] } }).catch(() => {})
      events.message(this.sender(peer, user), text)
      return
    }
    if (d.type === COMPONENT) {
      const pressed = data.custom_id ? this.buttons.get(data.custom_id) : undefined
      const original = (d.message as { content?: string } | undefined)?.content ?? ''
      // Acknowledge by updating the message: its buttons go away.
      await this.callback(d, { type: 7, data: { content: `${original}\n\n${pressed ? '→ Got it' : '→ That has ended'}`.slice(0, 2000), components: [] } })
      if (!pressed) return
      for (const [key, b] of this.buttons) {
        if (pressed.kind === 'approval' && b.kind === 'approval' && b.approvalId === pressed.approvalId) this.buttons.delete(key)
        if (pressed.kind === 'choice' && b.kind === 'choice' && b.group === pressed.group) this.buttons.delete(key)
      }
      if (pressed.kind === 'approval') events.answer(pressed.approvalId, pressed.answer)
      else events.choice?.(pressed.peer, pressed.value)
    }
  }

  /** The direct-message channel with a user (Discord gives back the same one each time). */
  private async dmWith(userId: string): Promise<string> {
    const known = this.dms.get(userId)
    if (known) return known
    const channel = await this.rest<{ id: string }>('POST', '/users/@me/channels', { recipient_id: userId })
    this.dms.set(userId, channel.id)
    return channel.id
  }

  /** Add the bot to a server, and open its profile (with its Message button). */
  setupLinks(): { label: string; url: string }[] {
    return [
      ...(this.appId ? [{ label: 'Add to a server', url: `https://discord.com/oauth2/authorize?client_id=${this.appId}&scope=bot%20applications.commands&permissions=0` }] : []),
      ...(this.botId ? [{ label: 'Message the bot', url: `https://discord.com/users/${this.botId}` }] : [])
    ]
  }

  private sender(peer: string, author: Author | undefined): { peer: string; name: string; username?: string } {
    return { peer, name: author?.global_name ?? author?.username ?? 'Discord', ...(author?.username ? { username: author.username } : {}) }
  }

  private async filesOf(raw: unknown): Promise<IncomingFile[]> {
    const list = Array.isArray(raw) ? (raw as { url?: string; filename?: string; content_type?: string; size?: number }[]) : []
    const out: IncomingFile[] = []
    for (const a of list.slice(0, 4)) {
      if (!a.url || (a.size ?? 0) > MAX_FILE_BYTES) continue
      const res = await this.http(a.url)
      if (!res.ok) continue
      const mimeType = a.content_type ?? 'application/octet-stream'
      out.push({ kind: mimeType.startsWith('image/') ? 'image' : 'document', name: a.filename ?? 'file', mimeType, bytes: new Uint8Array(await res.arrayBuffer()) })
    }
    return out
  }

  stop(): void {
    this.running = false
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    this.socket?.close()
    this.socket = null
  }

  async send(peer: string, text: string): Promise<void> {
    for (const piece of chunks(text, MAX_MESSAGE)) await this.rest('POST', `/channels/${peer}/messages`, { content: piece, allowed_mentions: { parse: [] } })
  }

  /** Discord shows Markdown itself. */
  async sendFormatted(peer: string, markdown: string): Promise<void> {
    await this.send(peer, markdown)
  }

  async draft(peer: string, text: string): Promise<string> {
    const sent = await this.rest<{ id: string }>('POST', `/channels/${peer}/messages`, { content: text.slice(0, 2000), allowed_mentions: { parse: [] } })
    return sent.id
  }

  async edit(peer: string, messageId: string, text: string): Promise<void> {
    await this.rest('PATCH', `/channels/${peer}/messages/${messageId}`, { content: text.slice(0, 2000) }).catch(() => {})
  }

  async remove(peer: string, messageId: string): Promise<void> {
    await this.rest('DELETE', `/channels/${peer}/messages/${messageId}`).catch(() => {})
  }

  async sendImage(peer: string, path: string, caption?: string): Promise<void> {
    const form = new FormData()
    form.append('payload_json', JSON.stringify({ content: caption?.slice(0, 1900) ?? '', attachments: [{ id: 0, filename: basename(path) }] }))
    form.append('files[0]', new Blob([new Uint8Array(readFileSync(path))]), basename(path))
    const res = await this.http(`${API}/channels/${peer}/messages`, { method: 'POST', headers: { Authorization: `Bot ${this.token}` }, body: form })
    if (!res.ok) throw new Error(`Discord couldn't take the image (HTTP ${res.status})`)
  }

  async react(peer: string, messageId: string, emoji: string): Promise<void> {
    await this.rest('PUT', `/channels/${peer}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`).catch(() => {})
  }

  private key(button: Button): string {
    const key = `b${++this.keySeq}`
    this.buttons.set(key, button)
    if (this.buttons.size > 500) this.buttons.delete(this.buttons.keys().next().value!)
    return key
  }

  private rows(buttons: Record<string, unknown>[]): { type: 1; components: Record<string, unknown>[] }[] {
    const rows: { type: 1; components: Record<string, unknown>[] }[] = []
    for (let i = 0; i < buttons.length && rows.length < 5; i += 5) rows.push({ type: 1, components: buttons.slice(i, i + 5) })
    return rows
  }

  async ask(peer: string, request: ApprovalRequest): Promise<void> {
    const buttons = approvalButtons(request).map((b) => ({ type: 2, style: b.answer === 'deny' ? 4 : 1, label: b.label.slice(0, 80), custom_id: this.key({ kind: 'approval', approvalId: request.id, answer: b.answer }) }))
    await this.rest('POST', `/channels/${peer}/messages`, { content: approvalText(request).slice(0, MAX_MESSAGE), components: this.rows(buttons) })
  }

  /** Buttons, up to 25 (Discord's five rows of five). */
  async choose(peer: string, text: string, options: { label: string; value: string }[]): Promise<void> {
    const group = `g${++this.keySeq}`
    const buttons = options.slice(0, 25).map((o) => ({ type: 2, style: 2, label: o.label.slice(0, 80), custom_id: this.key({ kind: 'choice', peer, value: o.value, group }) }))
    await this.rest('POST', `/channels/${peer}/messages`, { content: text.slice(0, MAX_MESSAGE), components: this.rows(buttons) })
  }

  async typing(peer: string): Promise<void> {
    await this.rest('POST', `/channels/${peer}/typing`).catch(() => {})
  }

  /**
   * Slash commands, for everyone (peer null; Discord has no per-person
   * commands): the bot's own (/model suggests models), each skill, MCP prompt
   * and plugin command with an optional text, and each skill pack with a
   * skill option that suggests its skills. Suggestions go to allowed people only.
   */
  async setCommands(commands: BotCommand[], peer: string | null): Promise<number | void> {
    if (peer !== null) return
    const app = await this.rest<{ id: string }>('GET', '/applications/@me')
    // Usable in servers, in direct messages with the bot and in group chats; answers always go to direct messages.
    const dmOnly = { contexts: [0, 1, 2], integration_types: [0] }
    const text = { type: TEXT_OPTION, name: 'text', description: 'What you want it to do', required: false }
    const body = commands.slice(0, 100).map((c) => ({
      name: c.command,
      description: c.description.slice(0, 100) || c.command,
      ...dmOnly,
      ...(c.command === 'model'
        ? { options: [{ type: TEXT_OPTION, name: 'name', description: 'The model to switch to', required: false, autocomplete: true }] }
        : c.pack
          ? { options: [{ type: TEXT_OPTION, name: 'skill', description: `One of the ${c.pack.length} skills`, required: true, autocomplete: true }, text] }
          : c.takesText
            ? { options: [text] }
            : {})
    }))
    const saved = await this.rest<unknown[]>('PUT', `/applications/${app.id}/commands`, body)
    return Array.isArray(saved) ? saved.length : body.length
  }
}
