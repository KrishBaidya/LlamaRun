import { EventEmitter } from 'node:events'
import { safeStorage } from 'electron'
import type { ChannelStatus, SlashCommand } from '@shared/types'
import { approvals } from '../assistant/approval'
import { readJson, writeJson } from '../jsonFile'
import { userDataPath } from '../paths'
import { DiscordChannel } from './discord'
import { TelegramChannel } from './telegram'
import type { BotCommand, Channel, ChannelEvents, ChannelId, Sender } from './types'

/**
 * Talking to Llama Run from the phone, like Hermes' and OpenClaw's messaging
 * gateways: the user's own Telegram or Discord bot. Nobody types a code:
 * someone new who messages the bot becomes a request in Settings > Channels
 * (with a notification), showing their name, username, id and first message,
 * and only the user at the PC can allow or block them, as OpenClaw's DM
 * pairing does. Allowed people each get their own chat; replies, approvals
 * (as buttons) and, if the user wants, routine results go back there.
 * Blocked people and strangers past the request limit hear nothing.
 */

interface Person {
  peer: string
  name: string
  username?: string
}

interface Paired extends Person {
  chatId?: string
}

interface Pending extends Person {
  /** Their first message, so the user can tell it's them. */
  text: string
  at: number
}

interface ChannelRecord {
  /** base64 of the safeStorage-encrypted token (plain when encryption is unavailable). */
  token?: string
  encrypted?: boolean
  botName?: string
  paired?: Paired[]
  pending?: Pending[]
  blocked?: Person[]
}

interface ChannelsFile {
  telegram?: ChannelRecord
  discord?: ChannelRecord
  /** Routine notifications also go to paired chats. */
  deliverRoutines?: boolean
}

/** What the bridge needs from the rest of the app (passed in, to keep this module free of it). */
export interface ChatPort {
  /** Runs the message in the chat (a new one when chatId is missing or gone); a skill or MCP prompt /command runs as such. */
  ask(chatId: string | undefined, text: string, via: string): Promise<{ chatId: string; done: Promise<{ status: string; content: string; error?: string }> }>
  busy(chatId: string): boolean
  queue(chatId: string, text: string): void
  stop(chatId: string): void
  compact(chatId: string): Promise<void>
  /** The chat's usage and the last 30 days, as text. */
  usage(chatId: string | undefined): string
  /** The chat's model (or the default one). */
  model(chatId: string | undefined): string
  setModel(chatId: string, model: string): void
  /** Models a chat can use, by id and name. */
  models(): Promise<{ id: string; name: string }[]>
  /** Skills and MCP prompts the user can run as /commands. */
  commands(): SlashCommand[]
  /** A desktop notification that someone asked to use the bot; clicking it opens Settings > Channels. */
  requestNotice(channel: string, name: string): void
}

const IDS: ChannelId[] = ['telegram', 'discord']
const LABEL: Record<ChannelId, string> = { telegram: 'Telegram', discord: 'Discord' }
/** Requests waiting at once per channel; more strangers are ignored, so nobody can flood the list. */
const MAX_PENDING = 5
/** A request nobody answered goes away after an hour, as OpenClaw's pairing codes do. */
const PENDING_MS = 60 * 60_000

/** The bot's own commands, handled here rather than by the model. */
export const BOT_COMMANDS: BotCommand[] = [
  { command: 'new', description: 'Start a fresh chat' },
  { command: 'stop', description: 'Stop the reply in progress' },
  { command: 'model', description: 'Show or change the model: /model <name or number>' },
  { command: 'compact', description: 'Summarise older messages to free up room' },
  { command: 'usage', description: 'Tokens used in this chat and the last 30 days' },
  { command: 'status', description: 'Model, chat and whether a reply is running' },
  { command: 'help', description: 'What the bot can do' }
]

/** Telegram allows lowercase letters, digits and underscores, up to 32 characters, and 100 commands. */
export function menuCommands(commands: SlashCommand[]): BotCommand[] {
  const seen = new Set(BOT_COMMANDS.map((c) => c.command))
  const out = [...BOT_COMMANDS]
  for (const c of commands) {
    if (c.kind !== 'skill' && c.kind !== 'mcp') continue
    const command = c.name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 32)
    if (!command || seen.has(command) || out.length >= 100) continue
    seen.add(command)
    out.push({ command, description: (c.description || c.name).replace(/\s+/g, ' ').slice(0, 100) })
  }
  return out
}

/** A menu command back to the /command it stands for (li_post -> /li-post). */
function fromMenu(text: string, commands: SlashCommand[]): string {
  const m = /^\/([a-z0-9_]+)(@\w+)?(\s[\s\S]*)?$/i.exec(text.trim())
  if (!m) return text
  const match = commands.find((c) => c.name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 32) === m[1].toLowerCase())
  return match ? `/${match.name}${m[3] ?? ''}` : text.replace(/^(\/\w+)@\w+/, '$1')
}

const HELP =
  'Messages here go to a chat on your PC, with its tools and skills. Approvals come as buttons. Computer use stays off from here.\n\n' +
  BOT_COMMANDS.map((c) => `/${c.command}: ${c.description}`).join('\n') +
  '\n\nYour skills and MCP prompts are in the / menu too.'

class ChannelHub extends EventEmitter<{ changed: [ChannelStatus[]] }> {
  private data: ChannelsFile | null = null
  private live = new Map<ChannelId, Channel>()
  private errors = new Map<ChannelId, string>()
  private port: ChatPort | null = null
  /** Chat id -> where its approvals go. */
  private routes = new Map<string, { id: ChannelId; peer: string }>()
  /** Model lists shown by /model, so "/model 2" picks from what they saw. */
  private shownModels = new Map<string, string[]>()
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

  private record(id: ChannelId): ChannelRecord & { paired: Paired[]; pending: Pending[]; blocked: Person[] } {
    const r = (this.load()[id] ??= {})
    r.paired ??= []
    r.pending ??= []
    r.blocked ??= []
    return r as ChannelRecord & { paired: Paired[]; pending: Pending[]; blocked: Person[] }
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

  /** Drops requests older than an hour. */
  private expire(r: { pending: Pending[] }): boolean {
    const before = r.pending.length
    r.pending = r.pending.filter((p) => Date.now() - p.at < PENDING_MS)
    return r.pending.length !== before
  }

  status(): ChannelStatus[] {
    return IDS.map((id) => {
      const r = this.load()[id]
      const fresh = (r?.pending ?? []).filter((p) => Date.now() - p.at < PENDING_MS)
      const person = (p: Person): { peer: string; name: string; username?: string } => ({ peer: p.peer, name: p.name, ...(p.username ? { username: p.username } : {}) })
      return {
        id,
        label: LABEL[id],
        configured: Boolean(r?.token),
        connected: this.live.has(id),
        ...(r?.botName ? { botName: r.botName } : {}),
        paired: (r?.paired ?? []).map(person),
        pending: fresh.map((p) => ({ ...person(p), text: p.text, at: p.at })),
        blocked: (r?.blocked ?? []).map(person),
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
    for (const id of IDS) for (const p of this.record(id).paired) if (p.chatId) this.routes.set(p.chatId, { id, peer: p.peer })
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
      void this.refreshCommands(id)
      return botName
    } catch (err) {
      this.errors.set(id, (err as Error).message)
      this.emit('changed', this.status())
      throw err
    }
  }

  /**
   * The bot's / menu: only for allowed people (Telegram's per-chat scope), so
   * a stranger who opens the bot doesn't see your skills. Call it when
   * skills, plugins or MCP prompts change.
   */
  async refreshCommands(only?: ChannelId): Promise<void> {
    const list = menuCommands(this.port?.commands() ?? [])
    for (const id of only ? [only] : IDS) {
      const channel = this.live.get(id)
      if (!channel?.setCommands) continue
      const peers = this.record(id).paired.map((p) => p.peer)
      // Skills and MCP servers report changes often: only call the app when the menu is different.
      const key = JSON.stringify([list, peers])
      if (!only && this.menus.get(id) === key) continue
      this.menus.set(id, key)
      for (const peer of peers) await channel.setCommands(list, peer).catch(() => {})
    }
  }

  /** The last menu sent per channel. */
  private menus = new Map<ChannelId, string>()

  /** Connects with a bot token the user pasted; saved encrypted once it works. */
  async connect(id: ChannelId, token: string): Promise<ChannelStatus[]> {
    if (!token.trim()) throw new Error('Paste the bot token first')
    const botName = await this.open(id, token)
    const r = this.record(id)
    const encrypted = safeStorage.isEncryptionAvailable()
    r.token = encrypted ? safeStorage.encryptString(token.trim()).toString('base64') : token.trim()
    r.encrypted = encrypted
    r.botName = botName
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

  /** The user allowed a request (or typed someone's id): they can use the bot from now on. */
  async approve(id: ChannelId, peer: string): Promise<ChannelStatus[]> {
    const r = this.record(id)
    const peerId = peer.trim()
    if (!/^-?\d{1,20}$/.test(peerId) && id === 'telegram') throw new Error('A Telegram id is a number. They can see theirs in the message the bot sent them.')
    if (!peerId) throw new Error('Enter an id')
    const request = r.pending.find((p) => p.peer === peerId)
    r.pending = r.pending.filter((p) => p.peer !== peerId)
    r.blocked = r.blocked.filter((p) => p.peer !== peerId)
    if (!r.paired.some((p) => p.peer === peerId)) r.paired.push({ peer: peerId, name: request?.name ?? `${LABEL[id]} ${peerId}`, ...(request?.username ? { username: request.username } : {}) })
    this.save()
    const channel = this.live.get(id)
    if (channel) {
      await channel.setCommands?.(menuCommands(this.port?.commands() ?? []), peerId).catch(() => {})
      await channel.send(peerId, `You're in. ${HELP}`).catch(() => {})
    }
    return this.status()
  }

  /** The user blocked someone: the bot ignores them from now on, without telling them. */
  block(id: ChannelId, peer: string): ChannelStatus[] {
    const r = this.record(id)
    const person = r.pending.find((p) => p.peer === peer) ?? r.paired.find((p) => p.peer === peer) ?? { peer, name: `${LABEL[id]} ${peer}` }
    this.forget(id, peer)
    if (!r.blocked.some((p) => p.peer === peer)) r.blocked.push({ peer, name: person.name, ...(person.username ? { username: person.username } : {}) })
    this.save()
    return this.status()
  }

  /** Removes someone from the allowed, waiting and blocked lists (they can ask again). */
  unpair(id: ChannelId, peer: string): ChannelStatus[] {
    this.forget(id, peer)
    this.save()
    return this.status()
  }

  private forget(id: ChannelId, peer: string): void {
    const r = this.record(id)
    for (const p of r.paired) if (p.peer === peer && p.chatId) this.routes.delete(p.chatId)
    if (r.paired.some((p) => p.peer === peer)) void this.live.get(id)?.setCommands?.([], peer).catch(() => {})
    r.paired = r.paired.filter((p) => p.peer !== peer)
    r.pending = r.pending.filter((p) => p.peer !== peer)
    r.blocked = r.blocked.filter((p) => p.peer !== peer)
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
      message: (from, text) => void this.onMessage(id, from, text),
      answer: (approvalId, answer) => {
        if (typeof answer === 'object') approvals.reply(approvalId, answer.text)
        else approvals.answer(approvalId, answer)
      }
    }
  }

  /** Someone new: a request for the user at the PC, and one reply telling them so. */
  private async request(id: ChannelId, channel: Channel, from: Sender, text: string): Promise<void> {
    const r = this.record(id)
    if (r.blocked.some((p) => p.peer === from.peer)) return
    const expired = this.expire(r)
    if (r.pending.some((p) => p.peer === from.peer)) {
      if (expired) this.save()
      return
    }
    if (r.pending.length >= MAX_PENDING) return
    r.pending.push({ peer: from.peer, name: from.name, ...(from.username ? { username: from.username } : {}), text: text.slice(0, 200), at: Date.now() })
    this.save()
    this.port?.requestNotice(LABEL[id], from.username ? `${from.name} (@${from.username})` : from.name)
    await channel
      .send(from.peer, `This bot belongs to someone's Llama Run. They've been asked whether to let you in.\nYour ${LABEL[id]} id is ${from.peer}.`)
      .catch(() => {})
  }

  /** Exposed for tests. */
  async onMessage(id: ChannelId, from: Sender, raw: string): Promise<void> {
    const channel = this.live.get(id)
    if (!channel || !this.port) return
    const paired = this.record(id).paired.find((p) => p.peer === from.peer)
    if (!paired) return this.request(id, channel, from, raw)
    const port = this.port
    const text = fromMenu(raw, port.commands())
    const command = /^\/([a-z]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text.trim())
    const name = command?.[1].toLowerCase()
    const arg = command?.[2]?.trim() ?? ''
    const reply = (t: string): Promise<void> => channel.send(from.peer, t).catch(() => {})

    if (name === 'start' || name === 'help') return reply(HELP)
    if (name === 'new') {
      if (paired.chatId) this.routes.delete(paired.chatId)
      paired.chatId = undefined
      this.save()
      return reply('Started a new chat.')
    }
    if (name === 'stop') {
      if (paired.chatId && port.busy(paired.chatId)) {
        port.stop(paired.chatId)
        return reply('Stopped.')
      }
      return reply('Nothing is running.')
    }
    if (name === 'usage') return reply(port.usage(paired.chatId) || 'No usage yet.')
    if (name === 'status') {
      const running = paired.chatId ? port.busy(paired.chatId) : false
      return reply(`Model: ${port.model(paired.chatId)}\nChat: ${paired.chatId ? 'ongoing' : 'none yet (your next message starts one)'}\nReply running: ${running ? 'yes' : 'no'}`)
    }
    if (name === 'compact') {
      if (!paired.chatId) return reply('Nothing to compact yet.')
      if (port.busy(paired.chatId)) return reply('Wait for the reply to finish, or /stop it.')
      await reply('Compacting…')
      return port.compact(paired.chatId).then(
        () => reply('Done: older messages are summarised.'),
        (err: Error) => reply(`Couldn't compact: ${err.message}`)
      )
    }
    if (name === 'model') return this.modelCommand(id, paired, arg, reply)

    // An open question in their chat: this message is the answer.
    const open = paired.chatId ? approvals.current(paired.chatId) : null
    if (open?.kind === 'question' && open.other !== false) {
      approvals.reply(open.id, text)
      return
    }
    if (paired.chatId && port.busy(paired.chatId)) {
      port.queue(paired.chatId, text)
      return reply('Queued: it goes in when the current reply finishes. /stop stops the reply.')
    }
    const typing = setInterval(() => void channel.typing(from.peer), 4500)
    void channel.typing(from.peer)
    try {
      const run = await port.ask(paired.chatId, text, LABEL[id])
      if (run.chatId !== paired.chatId) {
        paired.chatId = run.chatId
        this.routes.set(run.chatId, { id, peer: from.peer })
        this.save()
      }
      const done = await run.done
      if (done.status === 'cancelled') return
      await reply(done.status === 'error' ? `Something went wrong: ${done.error ?? 'the reply failed'}` : done.content || '(no text in the reply)')
    } catch (err) {
      await reply(`Couldn't send that to Llama Run: ${(err as Error).message}`)
    } finally {
      clearInterval(typing)
    }
  }

  private async modelCommand(id: ChannelId, paired: Paired, arg: string, reply: (t: string) => Promise<void>): Promise<void> {
    const port = this.port!
    const key = `${id}:${paired.peer}`
    if (!arg) {
      const models = await port.models()
      this.shownModels.set(key, models.map((m) => m.id))
      const current = port.model(paired.chatId)
      return reply(`Model: ${current}\n\n${models.map((m, i) => `${i + 1}. ${m.name}${m.id === current ? ' (current)' : ''}`).join('\n')}\n\nSend /model <number or name> to switch.`)
    }
    const models = await port.models()
    const shown = this.shownModels.get(key)
    const n = /^\d+$/.test(arg) ? Number(arg) : 0
    const pick = n ? (shown?.[n - 1] ? models.find((m) => m.id === shown[n - 1]) : models[n - 1]) : models.find((m) => m.id.toLowerCase() === arg.toLowerCase() || m.name.toLowerCase() === arg.toLowerCase()) ?? models.find((m) => m.name.toLowerCase().includes(arg.toLowerCase()))
    if (!pick) return reply(`No model matches "${arg}". Send /model to see the list.`)
    if (!paired.chatId) return reply(`Your next message starts a chat; send /model ${arg} after it to switch. (New chats use ${port.model(undefined)}.)`)
    port.setModel(paired.chatId, pick.id)
    return reply(`This chat now uses ${pick.name}.`)
  }

  stop(): void {
    for (const c of this.live.values()) c.stop()
    this.live.clear()
  }
}

export const channelHub = new ChannelHub()
