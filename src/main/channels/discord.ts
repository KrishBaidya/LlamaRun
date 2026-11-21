import type { ApprovalAnswer, ApprovalRequest } from '@shared/types'
import { approvalButtons, approvalText, chunks, type Channel, type ChannelEvents } from './types'

/**
 * Discord through the user's own bot application: direct messages over the
 * Gateway (a WebSocket the PC opens, so nothing reaches in), replies and
 * button presses over the REST API. Needs the Message Content intent turned
 * on for the bot in the Developer Portal.
 */

const API = 'https://discord.com/api/v10'
const MAX_MESSAGE = 1900
/** DIRECT_MESSAGES | MESSAGE_CONTENT */
const INTENTS = (1 << 12) | (1 << 15)

interface Dispatch {
  op: number
  t?: string
  s?: number | null
  d?: Record<string, unknown> & { heartbeat_interval?: number }
}

export class DiscordChannel implements Channel {
  readonly id = 'discord' as const
  private token = ''
  private socket: WebSocket | null = null
  private heartbeat: NodeJS.Timeout | null = null
  private seq: number | null = null
  private running = false
  private failures = 0
  private buttons = new Map<string, { approvalId: string; answer: ApprovalAnswer | { text: string } }>()
  private keySeq = 0

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
    const me = await this.rest<{ username: string }>('GET', '/users/@me')
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
        this.dispatch(msg, events)
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

  /** Handles a Gateway event (separate for tests). */
  dispatch(msg: Dispatch, events: ChannelEvents): void {
    const d = msg.d ?? {}
    if (msg.t === 'MESSAGE_CREATE') {
      const author = d.author as { bot?: boolean; username?: string; global_name?: string } | undefined
      // Direct messages only (no guild), never from bots.
      if (d.guild_id || author?.bot || typeof d.content !== 'string' || !d.content.trim()) return
      events.message({ peer: String(d.channel_id), name: author?.global_name ?? author?.username ?? 'Discord', ...(author?.username ? { username: author.username } : {}) }, d.content)
    } else if (msg.t === 'INTERACTION_CREATE') {
      const data = d.data as { custom_id?: string } | undefined
      const pressed = data?.custom_id ? this.buttons.get(data.custom_id) : undefined
      const original = (d.message as { content?: string } | undefined)?.content ?? ''
      // Acknowledge by updating the message: its buttons go away.
      void this.rest('POST', `/interactions/${String(d.id)}/${String(d.token)}/callback`, {
        type: 7,
        data: { content: `${original}\n\n${pressed ? '→ Answered' : '→ That question has ended'}`.slice(0, 2000), components: [] }
      }).catch(() => {})
      if (pressed) {
        for (const [key, b] of this.buttons) if (b.approvalId === pressed.approvalId) this.buttons.delete(key)
        events.answer(pressed.approvalId, pressed.answer)
      }
    }
  }

  stop(): void {
    this.running = false
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    this.socket?.close()
    this.socket = null
  }

  async send(peer: string, text: string): Promise<void> {
    for (const piece of chunks(text, MAX_MESSAGE)) await this.rest('POST', `/channels/${peer}/messages`, { content: piece })
  }

  async ask(peer: string, request: ApprovalRequest): Promise<void> {
    const buttons = approvalButtons(request).map((b) => {
      const key = `a${++this.keySeq}`
      this.buttons.set(key, { approvalId: request.id, answer: b.answer })
      return { type: 2, style: b.answer === 'deny' ? 4 : 1, label: b.label.slice(0, 80), custom_id: key }
    })
    if (this.buttons.size > 500) this.buttons.delete(this.buttons.keys().next().value!)
    const rows: { type: 1; components: typeof buttons }[] = []
    for (let i = 0; i < buttons.length && rows.length < 5; i += 5) rows.push({ type: 1, components: buttons.slice(i, i + 5) })
    await this.rest('POST', `/channels/${peer}/messages`, { content: approvalText(request).slice(0, MAX_MESSAGE), components: rows })
  }

  async typing(peer: string): Promise<void> {
    await this.rest('POST', `/channels/${peer}/typing`).catch(() => {})
  }
}
