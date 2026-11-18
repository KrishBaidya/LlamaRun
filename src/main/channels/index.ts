import { randomInt } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { safeStorage } from 'electron'
import type { ChannelStatus } from '@shared/types'
import { approvals } from '../assistant/approval'
import { readJson, writeJson } from '../jsonFile'
import { userDataPath } from '../paths'
import { DiscordChannel } from './discord'
import { TelegramChannel } from './telegram'
import type { Channel, ChannelEvents, ChannelId } from './types'

/**
 * Talking to Llama Run from the phone, like Hermes' and OpenClaw's messaging
 * gateways: the user's own Telegram or Discord bot, paired with their own
 * account by a code shown in Settings. Each paired account gets its own chat;
 * replies, approvals (as buttons) and, if they want, routine results go back
 * there. Strangers who find the bot get a refusal, nothing else.
 */

interface Paired {
  peer: string
  name: string
  chatId?: string
}

interface ChannelRecord {
  /** base64 of the safeStorage-encrypted token (plain when encryption is unavailable). */
  token?: string
  encrypted?: boolean
  botName?: string
  pairCode?: string
  paired: Paired[]
}

interface ChannelsFile {
  telegram?: ChannelRecord
  discord?: ChannelRecord
  /** Routine notifications also go to paired chats. */
  deliverRoutines?: boolean
}

/** What the bridge needs from the chat service (passed in, to keep this module free of it). */
export interface ChatPort {
  /** Runs the message in the chat (a new one when chatId is missing or gone); resolves with the new chat id and the reply. */
  ask(chatId: string | undefined, text: string, via: string): { chatId: string; done: Promise<{ status: string; content: string; error?: string }> }
  busy(chatId: string): boolean
  queue(chatId: string, text: string): void
}

const IDS: ChannelId[] = ['telegram', 'discord']
const LABEL: Record<ChannelId, string> = { telegram: 'Telegram', discord: 'Discord' }

class ChannelHub extends EventEmitter<{ changed: [ChannelStatus[]] }> {
  private data: ChannelsFile | null = null
  private live = new Map<ChannelId, Channel>()
  private errors = new Map<ChannelId, string>()
  private port: ChatPort | null = null
  /** Chat id -> where its approvals go. */
  private routes = new Map<string, { id: ChannelId; peer: string }>()
  /** Peers told they aren't paired, so a stranger isn't answered every time. */
  private refused = new Set<string>()
  factory: (id: ChannelId) => Channel = (id) => (id === 'telegram' ? new TelegramChannel() : new DiscordChannel())

  private get path(): string {
    return userDataPath('channels.json')
  }

  private load(): ChannelsFile {
    this.data ??= readJson<ChannelsFile>(this.path, {})
    return this.data
  }

  private save(): void {
    writeJson(this.path, this.load())
    this.emit('changed', this.status())
  }

  private record(id: ChannelId): ChannelRecord {
    const data = this.load()
    return (data[id] ??= { paired: [] })
  }

  private tokenOf(r: ChannelRecord): string {
    if (!r.token) return ''
    if (!r.encrypted) return r.token
    try {
      return safeStorage.decryptString(Buffer.from(r.token, 'base64'))
    } catch {
      return ''
    }
  }

  status(): ChannelStatus[] {
    return IDS.map((id) => {
      const r = this.load()[id]
      return {
        id,
        label: LABEL[id],
        configured: Boolean(r?.token),
        connected: this.live.has(id),
        ...(r?.botName ? { botName: r.botName } : {}),
        ...(r?.pairCode ? { pairCode: r.pairCode } : {}),
        paired: (r?.paired ?? []).map((p) => ({ peer: p.peer, name: p.name })),
        ...(this.errors.get(id) ? { error: this.errors.get(id) } : {}),
        deliverRoutines: this.load().deliverRoutines === true
      }
    })
  }

  /** Starts the configured channels and watches approvals for paired chats. */
  start(port: ChatPort): void {
    this.port = port
    for (const id of IDS) {
      const token = this.tokenOf(this.record(id))
      if (token) void this.open(id, token).catch(() => {})
    }
    for (const [id, r] of Object.entries(this.load()) as [ChannelId, ChannelRecord][]) {
      if (!IDS.includes(id)) continue
      for (const p of r.paired) if (p.chatId) this.routes.set(p.chatId, { id, peer: p.peer })
    }
    approvals.on('changed', (chatId, request) => {
      const route = request ? this.routes.get(chatId) : undefined
      if (route && request) void this.live.get(route.id)?.ask(route.peer, request).catch(() => {})
    })
  }

  private async open(id: ChannelId, token: string): Promise<string> {
    this.live.get(id)?.stop()
    this.live.delete(id)
    const channel = this.factory(id)
    try {
      const { botName } = await channel.start(token, this.events(id))
      this.live.set(id, channel)
      this.errors.delete(id)
      this.emit('changed', this.status())
      return botName
    } catch (err) {
      this.errors.set(id, (err as Error).message)
      this.emit('changed', this.status())
      throw err
    }
  }

  /** Connects with a bot token the user pasted; saved encrypted once it works. A new pairing code is made. */
  async connect(id: ChannelId, token: string): Promise<ChannelStatus[]> {
    if (!token.trim()) throw new Error('Paste the bot token first')
    const botName = await this.open(id, token)
    const r = this.record(id)
    const encrypted = safeStorage.isEncryptionAvailable()
    r.token = encrypted ? safeStorage.encryptString(token.trim()).toString('base64') : token.trim()
    r.encrypted = encrypted
    r.botName = botName
    r.pairCode = String(randomInt(100000, 1000000))
    this.save()
    return this.status()
  }

  disconnect(id: ChannelId): ChannelStatus[] {
    this.live.get(id)?.stop()
    this.live.delete(id)
    this.errors.delete(id)
    for (const [chatId, route] of this.routes) if (route.id === id) this.routes.delete(chatId)
    delete this.load()[id]
    this.save()
    return this.status()
  }

  /** A fresh code, for pairing another account. */
  newCode(id: ChannelId): ChannelStatus[] {
    const r = this.record(id)
    r.pairCode = String(randomInt(100000, 1000000))
    this.save()
    return this.status()
  }

  unpair(id: ChannelId, peer: string): ChannelStatus[] {
    const r = this.record(id)
    for (const p of r.paired) if (p.peer === peer && p.chatId) this.routes.delete(p.chatId)
    r.paired = r.paired.filter((p) => p.peer !== peer)
    this.save()
    return this.status()
  }

  setDeliver(on: boolean): ChannelStatus[] {
    this.load().deliverRoutines = on
    this.save()
    return this.status()
  }

  /** A routine's notification, to every paired chat when the user asked for that. */
  deliver(text: string): void {
    if (!this.load().deliverRoutines) return
    for (const id of IDS) for (const p of this.record(id).paired) void this.live.get(id)?.send(p.peer, text).catch(() => {})
  }

  private events(id: ChannelId): ChannelEvents {
    return {
      message: (peer, name, text) => void this.onMessage(id, peer, name, text),
      answer: (approvalId, answer) => {
        if (typeof answer === 'object') approvals.reply(approvalId, answer.text)
        else approvals.answer(approvalId, answer)
      }
    }
  }

  /** Exposed for tests. */
  async onMessage(id: ChannelId, peer: string, name: string, text: string): Promise<void> {
    const channel = this.live.get(id)
    if (!channel || !this.port) return
    const r = this.record(id)
    const paired = r.paired.find((p) => p.peer === peer)
    if (!paired) {
      const code = /(\d{6})/.exec(text)?.[1]
      if (r.pairCode && code === r.pairCode) {
        r.paired.push({ peer, name })
        r.pairCode = undefined
        this.save()
        await channel.send(peer, `Paired with Llama Run. Messages here go to a chat on your PC; send /new to start a fresh one.`)
      } else if (!this.refused.has(`${id}:${peer}`)) {
        this.refused.add(`${id}:${peer}`)
        await channel.send(peer, "This bot belongs to someone's Llama Run. To use it, pair it from Llama Run's Settings > Channels.")
      }
      return
    }
    if (/^\/new\s*$/i.test(text.trim())) {
      if (paired.chatId) this.routes.delete(paired.chatId)
      paired.chatId = undefined
      this.save()
      await channel.send(peer, 'Started a new chat.')
      return
    }
    // An open question in their chat: this message is the answer.
    const open = paired.chatId ? approvals.current(paired.chatId) : null
    if (open?.kind === 'question' && open.other !== false) {
      approvals.reply(open.id, text)
      return
    }
    if (paired.chatId && this.port.busy(paired.chatId)) {
      this.port.queue(paired.chatId, text)
      await channel.send(peer, 'Queued: it goes in when the current reply finishes.')
      return
    }
    const typing = setInterval(() => void channel.typing(peer), 4500)
    void channel.typing(peer)
    try {
      const run = this.port.ask(paired.chatId, text, LABEL[id])
      if (run.chatId !== paired.chatId) {
        paired.chatId = run.chatId
        this.routes.set(run.chatId, { id, peer })
        this.save()
      }
      const reply = await run.done
      await channel.send(peer, reply.status === 'error' ? `Something went wrong: ${reply.error ?? 'the reply failed'}` : reply.content || '(no text in the reply)')
    } catch (err) {
      await channel.send(peer, `Couldn't send that to Llama Run: ${(err as Error).message}`).catch(() => {})
    } finally {
      clearInterval(typing)
    }
  }

  stop(): void {
    for (const c of this.live.values()) c.stop()
    this.live.clear()
  }
}

export const channelHub = new ChannelHub()
