import { EventEmitter } from 'node:events'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import type { ChannelStatus, ChatAttachment, ChatEvent, SlashCommand } from '@shared/types'
import { approvals } from '../assistant/approval'
import { readJson, writeJson } from '../jsonFile'
import { logsDir, userDataPath } from '../paths'
import { DiscordChannel } from './discord'
import { TelegramChannel } from './telegram'
import type { BotCommand, Channel, ChannelEvents, ChannelId, IncomingFile, MessageExtra, Sender } from './types'
import { chunks } from './types'

/**
 * Talking to Llama Run from the phone, like Hermes' and OpenClaw's messaging
 * gateways: the user's own Telegram or Discord bot. Nobody types a code:
 * someone new who messages the bot becomes a request in Settings > Channels
 * (with a notification), showing their name, username, id and first message,
 * and only the user at the PC can allow or block them, as OpenClaw's DM
 * pairing does. Allowed people each get their own chat; replies stream into
 * one message as they're written, photos and files go in as attachments,
 * images the model makes come back, and approvals arrive as buttons. Blocked
 * people and strangers past the request limit hear nothing.
 */

interface Person {
  peer: string
  name: string
  username?: string
}

interface Paired extends Person {
  chatId?: string
  /** The model their next new chat starts with, picked with /model before a chat existed. */
  model?: string
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

type Done = { status: string; content: string; error?: string }

/** What the bridge needs from the rest of the app (passed in, to keep this module free of it). */
export interface ChatPort {
  /** Runs the message in the chat (a new one when chatId is missing or gone); a skill or MCP prompt /command runs as such. */
  ask(chatId: string | undefined, text: string, via: string, options?: { model?: string; attachments?: ChatAttachment[] }): Promise<{ chatId: string; done: Promise<Done> }>
  /** The chat's events while a reply runs (text as it streams, tool calls); returns the unsubscribe. */
  watch?(chatId: string, listener: (event: ChatEvent) => void): () => void
  /** A photo or file someone sent, as an attachment the model reads. */
  attach?(file: IncomingFile): Promise<ChatAttachment | null>
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
  /** Skills, MCP prompts and plugin commands the user can run as /commands. */
  commands(): SlashCommand[]
  /** Runs a plugin's /command and waits for its reply; null when no plugin has it. */
  pluginCommand?(chatId: string | undefined, text: string): Promise<{ chatId: string; reply: string | null } | null>
  /** The tools a chat's model can use, with where each comes from. */
  tools?(): { name: string; server: string }[]
  /** A desktop notification that someone asked to use the bot; clicking it opens Settings > Channels. */
  requestNotice(channel: string, name: string): void
}

const IDS: ChannelId[] = ['telegram', 'discord']
const LABEL: Record<ChannelId, string> = { telegram: 'Telegram', discord: 'Discord' }
/** Requests waiting at once per channel; more strangers are ignored, so nobody can flood the list. */
const MAX_PENDING = 5
/** A request nobody answered goes away after an hour, as OpenClaw's pairing codes do. */
const PENDING_MS = 60 * 60_000
/** How often a streaming reply's message is edited (Telegram allows about one edit a second per chat). */
const EDIT_EVERY_MS = 1200
/** A streaming message moves on to a new one past this length. */
const DRAFT_MAX = 3500

/** The bot's own commands, handled here rather than by the model. */
export const BOT_COMMANDS: BotCommand[] = [
  { command: 'new', description: 'Start a fresh chat' },
  { command: 'stop', description: 'Stop the reply in progress' },
  { command: 'model', description: 'Show or change the model' },
  { command: 'compact', description: 'Summarise older messages to free up room' },
  { command: 'usage', description: 'Tokens used in this chat and the last 30 days' },
  { command: 'status', description: 'Model, chat and whether a reply is running' },
  { command: 'tools', description: 'Tools the model can use: Llama Run, MCP servers, plugins' },
  { command: 'help', description: 'What the bot can do' }
]

const menuName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)

/**
 * The bot's own commands, then plugin commands, MCP prompts and skills, with
 * names Telegram accepts: lowercase letters, digits and underscores, up to 32
 * characters, descriptions up to 256, and 100 commands at most.
 */
export function menuCommands(commands: SlashCommand[]): BotCommand[] {
  const seen = new Set(BOT_COMMANDS.map((c) => c.command))
  const out = [...BOT_COMMANDS]
  const order: SlashCommand['kind'][] = ['plugin', 'mcp', 'skill']
  const runnable = commands.filter((c) => order.includes(c.kind)).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
  for (const c of runnable) {
    const command = menuName(c.name)
    if (!command || seen.has(command) || out.length >= 100) continue
    seen.add(command)
    const description = (c.description || c.name).replace(/\s+/g, ' ').trim()
    out.push({ command, description: description.length > 100 ? `${description.slice(0, 99)}…` : description || command })
  }
  return out
}

/** A menu command back to the /command it stands for (li_post -> /li-post). */
function fromMenu(text: string, commands: SlashCommand[]): string {
  const m = /^\/([a-z0-9_]+)(@\w+)?(\s[\s\S]*)?$/i.exec(text.trim())
  if (!m) return text
  const match = commands.find((c) => menuName(c.name) === m[1].toLowerCase())
  return match ? `/${match.name}${m[3] ?? ''}` : text.replace(/^(\/\w+)@\w+/, '$1')
}

const HELP =
  'Messages here go to a chat on your PC, with its tools and skills. Send photos and files too. Approvals come as buttons. Computer use stays off from here.\n\n' +
  BOT_COMMANDS.map((c) => `/${c.command}: ${c.description}`).join('\n') +
  '\n\nYour skills and MCP prompts are in the / menu too.'

const PROFILE = {
  description: "This is someone's own Llama Run. Only people they allow can use it: message the bot and they're asked on their PC.",
  short: 'A Llama Run, reached from your phone.'
}

/** "Saved C:\...\x.png" from image_generate's result. */
const savedImage = (result: string | undefined): string | null => /^Saved (.+?\.(?:png|jpe?g|webp))(?:\s|$)/i.exec(result ?? '')?.[1] ?? null

/**
 * One reply streaming into a chat app: a message edited as text arrives (at
 * most about once a second), a line saying which tool is running, a new
 * message once one gets long, and the final text formatted.
 */
class StreamedReply {
  private ids: string[] = []
  /** Messages already holding a full part. */
  private completed = 0
  private text = ''
  private status = ''
  private shown = ''
  private timer: NodeJS.Timeout | null = null
  private sending: Promise<void> = Promise.resolve()
  private done = false

  constructor(
    private readonly channel: Channel & Required<Pick<Channel, 'draft' | 'edit'>>,
    private readonly peer: string
  ) {}

  add(text: string): void {
    this.text += text
    this.status = ''
    this.schedule()
  }

  tool(label: string | null): void {
    this.status = label ? `⏳ ${label}` : ''
    this.schedule()
  }

  /** The text of the message being written now (earlier messages are full). */
  private current(): string {
    const parts = chunks(this.text || ' ', DRAFT_MAX)
    return parts[parts.length - 1]
  }

  private schedule(): void {
    if (this.timer || this.done) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.sending = this.sending.then(() => this.flush())
    }, this.ids.length ? EDIT_EVERY_MS : 300)
  }

  private async flush(): Promise<void> {
    if (this.done) return
    const parts = chunks(this.text || ' ', DRAFT_MAX)
    // Parts that filled up: each keeps its own message with its full text.
    for (let i = this.completed; i < parts.length - 1; i++) {
      if (this.ids[i]) await this.channel.edit(this.peer, this.ids[i], parts[i], false)
      else this.ids.push(await this.channel.draft(this.peer, parts[i]))
      this.completed = i + 1
      this.shown = ''
    }
    const body = [this.text.trim() ? this.current() : '', this.status || (this.text.trim() ? '' : '⏳ Thinking…')].filter(Boolean).join('\n\n')
    if (body === this.shown) return
    this.shown = body
    const last = parts.length - 1
    if (this.ids[last]) await this.channel.edit(this.peer, this.ids[last], body, false)
    else this.ids.push(await this.channel.draft(this.peer, body))
  }

  /** The whole reply, formatted, in as many messages as it needs; extra drafts are removed. */
  async finish(content: string): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    await this.sending.catch(() => {})
    this.done = true
    const parts = chunks(content, DRAFT_MAX)
    for (let i = 0; i < parts.length; i++) {
      if (this.ids[i]) await this.channel.edit(this.peer, this.ids[i], parts[i], true)
      else if (this.channel.sendFormatted) await this.channel.sendFormatted(this.peer, parts[i])
      else await this.channel.send(this.peer, parts[i])
    }
    for (const id of this.ids.slice(parts.length)) await this.channel.remove?.(this.peer, id)
  }

  /** Stopped or failed: the drafts go, so a half reply isn't left looking finished. */
  async abandon(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.done = true
    await this.sending.catch(() => {})
    for (const id of this.ids) await this.channel.remove?.(this.peer, id)
  }
}

class ChannelHub extends EventEmitter<{ changed: [ChannelStatus[]] }> {
  private data: ChannelsFile | null = null
  private live = new Map<ChannelId, Channel>()
  private errors = new Map<ChannelId, string>()
  private port: ChatPort | null = null
  /** Chat id -> where its approvals go. */
  private routes = new Map<string, { id: ChannelId; peer: string }>()
  /** The last menu each person was sent, so it's only sent again when it changes. */
  private menus = new Map<string, string>()
  /** What happened to each channel's menus, for Settings. */
  private menuInfo = new Map<ChannelId, string>()

  private log(line: string): void {
    try {
      mkdirSync(logsDir(), { recursive: true })
      appendFileSync(join(logsDir(), 'channels.log'), `${new Date().toISOString()} ${line}\n`)
    } catch {
      /* logging is best effort */
    }
  }
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
        ...(this.menuInfo.get(id) ? { menu: this.menuInfo.get(id) } : {}),
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
      for (const key of [...this.menus.keys()]) if (key.startsWith(`${id}:`)) this.menus.delete(key)
      void channel.setProfile?.(PROFILE.description, PROFILE.short).catch(() => {})
      void this.refreshCommands(id)
      return botName
    } catch (err) {
      this.errors.set(id, (err as Error).message)
      this.emit('changed', this.status())
      throw err
    }
  }

  /** Sends one menu (null peer: everyone's default) unless it's what they already have; a failure shows in Settings. */
  private async sendMenu(id: ChannelId, peer: string | null, list: BotCommand[]): Promise<void> {
    const channel = this.live.get(id)
    if (!channel?.setCommands) return
    const key = `${id}:${peer ?? '*'}`
    const value = JSON.stringify(list)
    if (this.menus.get(key) === value) return
    const who = peer === null ? 'everyone' : (this.record(id).paired.find((p) => p.peer === peer)?.name ?? peer)
    try {
      const confirmed = await channel.setCommands(list, peer)
      this.menus.set(key, value)
      const count = typeof confirmed === 'number' ? confirmed : list.length
      this.log(`${id} menu for ${who}: sent ${list.length}, ${typeof confirmed === 'number' ? `${LABEL[id]} has ${confirmed}` : 'not checked'}`)
      if (peer !== null) this.menuInfo.set(id, `Menu: ${count} commands for ${who}${typeof confirmed === 'number' ? `, confirmed by ${LABEL[id]}` : ''} (${new Date().toLocaleTimeString()}). If it looks old in the app, close and reopen the chat with the bot.`)
      if (this.errors.get(id)?.startsWith('Menu:')) this.errors.delete(id)
      this.emit('changed', this.status())
    } catch (err) {
      this.menus.delete(key)
      this.log(`${id} menu for ${who} failed: ${(err as Error).message}`)
      this.errors.set(id, `Menu: couldn't update the bot's / menu for ${who}: ${(err as Error).message}`)
      this.emit('changed', this.status())
    }
  }

  /**
   * The bot's / menus: everyone sees the bot's own commands; allowed people
   * also see their skills and MCP prompts (set for their chat only, so a
   * stranger who opens the bot doesn't see them). Call it when skills,
   * plugins or MCP prompts change; only what changed is sent.
   */
  async refreshCommands(only?: ChannelId): Promise<void> {
    const list = menuCommands(this.port?.commands() ?? [])
    for (const id of only ? [only] : IDS) {
      if (!this.live.has(id)) continue
      await this.sendMenu(id, null, BOT_COMMANDS)
      for (const p of this.record(id).paired) await this.sendMenu(id, p.peer, list)
    }
  }

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
    if (!peerId) throw new Error('Enter an id')
    if (!/^-?\d{1,20}$/.test(peerId)) throw new Error(`A ${LABEL[id]} id is a number. They can see theirs in the message the bot sent them.`)
    const request = r.pending.find((p) => p.peer === peerId)
    r.pending = r.pending.filter((p) => p.peer !== peerId)
    r.blocked = r.blocked.filter((p) => p.peer !== peerId)
    if (!r.paired.some((p) => p.peer === peerId)) r.paired.push({ peer: peerId, name: request?.name ?? `${LABEL[id]} ${peerId}`, ...(request?.username ? { username: request.username } : {}) })
    this.save()
    const channel = this.live.get(id)
    if (channel) {
      await this.sendMenu(id, peerId, menuCommands(this.port?.commands() ?? []))
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
    if (r.paired.some((p) => p.peer === peer)) {
      this.menus.delete(`${id}:${peer}`)
      void this.live.get(id)?.setCommands?.([], peer).catch(() => {})
    }
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
    for (const id of IDS) {
      const channel = this.live.get(id)
      for (const p of this.record(id).paired) void (channel?.sendFormatted ? channel.sendFormatted(p.peer, text) : channel?.send(p.peer, text))?.catch(() => {})
    }
  }

  private events(id: ChannelId): ChannelEvents {
    return {
      message: (from, text, extra) => void this.onMessage(id, from, text, extra),
      answer: (approvalId, answer) => {
        if (typeof answer === 'object') approvals.reply(approvalId, answer.text)
        else approvals.answer(approvalId, answer)
      },
      choice: (peer, value) => void this.onChoice(id, peer, value)
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
    r.pending.push({ peer: from.peer, name: from.name, ...(from.username ? { username: from.username } : {}), text: (text || '(a file)').slice(0, 200), at: Date.now() })
    this.save()
    this.port?.requestNotice(LABEL[id], from.username ? `${from.name} (@${from.username})` : from.name)
    await channel
      .send(from.peer, `This bot belongs to someone's Llama Run. They've been asked whether to let you in.\nYour ${LABEL[id]} id is ${from.peer}.`)
      .catch(() => {})
  }

  /** A model button from /model. */
  private async onChoice(id: ChannelId, peer: string, value: string): Promise<void> {
    const channel = this.live.get(id)
    const paired = this.record(id).paired.find((p) => p.peer === peer)
    if (!channel || !paired || !this.port || !value.startsWith('model:')) return
    const model = value.slice('model:'.length)
    const name = (await this.port.models()).find((m) => m.id === model)?.name ?? model
    this.pickModel(paired, model)
    await channel.send(peer, paired.chatId ? `This chat now uses ${name}.` : `Your next chat starts with ${name}.`).catch(() => {})
  }

  private pickModel(paired: Paired, model: string): void {
    paired.model = model
    if (paired.chatId) this.port!.setModel(paired.chatId, model)
    this.save()
  }

  /** Exposed for tests. */
  async onMessage(id: ChannelId, from: Sender, raw: string, extra: MessageExtra = {}): Promise<void> {
    const channel = this.live.get(id)
    if (!channel || !this.port) return
    const paired = this.record(id).paired.find((p) => p.peer === from.peer)
    if (!paired) return this.request(id, channel, from, raw)
    const port = this.port
    // A menu that failed to arrive earlier gets another try.
    void this.sendMenu(id, from.peer, menuCommands(port.commands()))
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
      const model = paired.chatId ? port.model(paired.chatId) : (paired.model ?? port.model(undefined))
      return reply(`Model: ${model}\nChat: ${paired.chatId ? 'ongoing' : 'none yet (your next message starts one)'}\nReply running: ${running ? 'yes' : 'no'}`)
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
    if (name === 'model') return this.modelCommand(channel, paired, arg, reply)
    if (name === 'tools') {
      const tools = port.tools?.() ?? []
      if (!tools.length) return reply('No tools right now.')
      const groups = new Map<string, string[]>()
      for (const t of tools) groups.set(t.server, [...(groups.get(t.server) ?? []), t.name])
      return reply([...groups].map(([server, names]) => `${server} (${names.length}):\n${names.join(', ')}`).join('\n\n'))
    }
    // A plugin's /command: it answers itself, without the model.
    if (text.trim().startsWith('/') && port.pluginCommand) {
      const ran = await port.pluginCommand(paired.chatId, text).catch((err: Error) => ({ chatId: paired.chatId ?? '', reply: `That command failed: ${err.message}` }))
      if (ran) {
        if (ran.chatId && ran.chatId !== paired.chatId) {
          paired.chatId = ran.chatId
          this.routes.set(ran.chatId, { id, peer: from.peer })
          this.save()
        }
        if (!ran.reply) return reply('Done.')
        return void (await (channel.sendFormatted ? channel.sendFormatted(from.peer, ran.reply) : channel.send(from.peer, ran.reply)).catch(() => {}))
      }
    }

    if (extra.messageId) void channel.react?.(from.peer, extra.messageId, '👀')
    const attachments: ChatAttachment[] = []
    for (const file of extra.files ?? []) {
      const a = await port.attach?.(file).catch(() => null)
      if (a) attachments.push(a)
      else await reply(`Couldn't read ${file.name}.`)
    }
    const message = text.trim() || (attachments.length ? (attachments.some((a) => a.kind === 'image') ? 'What do you see in this?' : 'Here is a file.') : '')
    if (!message) return

    // An open question in their chat: this message is the answer.
    const open = paired.chatId ? approvals.current(paired.chatId) : null
    if (open?.kind === 'question' && open.other !== false && !attachments.length) {
      approvals.reply(open.id, message)
      return
    }
    if (paired.chatId && port.busy(paired.chatId)) {
      port.queue(paired.chatId, message)
      return reply('Queued: it goes in when the current reply finishes. /stop stops the reply.')
    }
    const typing = setInterval(() => void channel.typing(from.peer), 4500)
    void channel.typing(from.peer)
    let unwatch = (): void => {}
    const stream = channel.draft && channel.edit && port.watch ? new StreamedReply(channel as Channel & Required<Pick<Channel, 'draft' | 'edit'>>, from.peer) : null
    const images: string[] = []
    try {
      const run = await port.ask(paired.chatId, message, LABEL[id], { ...(!paired.chatId && paired.model ? { model: paired.model } : {}), ...(attachments.length ? { attachments } : {}) })
      if (run.chatId !== paired.chatId) {
        paired.chatId = run.chatId
        this.routes.set(run.chatId, { id, peer: from.peer })
        this.save()
      }
      unwatch =
        port.watch?.(run.chatId, (event) => {
          if (event.type === 'delta') stream?.add(event.text)
          else if (event.type === 'tool') stream?.tool(`Using ${event.tool.name}…`)
          else if (event.type === 'tool-done') {
            stream?.tool(null)
            const saved = event.part.name === 'image_generate' && event.part.status === 'done' ? savedImage(event.part.result) : null
            if (saved) images.push(saved)
          }
        }) ?? unwatch
      const done = await run.done
      unwatch()
      if (done.status === 'cancelled') return void (await stream?.abandon())
      if (done.status === 'error') {
        await stream?.abandon()
        return reply(`Something went wrong: ${done.error ?? 'the reply failed'}`)
      }
      const content = done.content || (images.length ? '' : '(no text in the reply)')
      if (content) {
        if (stream) await stream.finish(content)
        else if (channel.sendFormatted) await channel.sendFormatted(from.peer, content)
        else await reply(content)
      } else await stream?.abandon()
      for (const path of images) await channel.sendImage?.(from.peer, path).catch(() => {})
    } catch (err) {
      unwatch()
      await stream?.abandon()
      await reply(`Couldn't send that to Llama Run: ${(err as Error).message}`)
    } finally {
      clearInterval(typing)
    }
  }

  private async modelCommand(channel: Channel, paired: Paired, arg: string, reply: (t: string) => Promise<void>): Promise<void> {
    const port = this.port!
    const models = await port.models()
    const current = paired.chatId ? port.model(paired.chatId) : (paired.model ?? port.model(undefined))
    if (!arg) {
      if (channel.choose) {
        return channel.choose(
          paired.peer,
          `Model: ${models.find((m) => m.id === current)?.name ?? current}\nPick one:`,
          models.map((m) => ({ label: `${m.id === current ? '✓ ' : ''}${m.name}`, value: `model:${m.id}` }))
        )
      }
      return reply(`Model: ${current}\n\n${models.map((m, i) => `${i + 1}. ${m.name}${m.id === current ? ' (current)' : ''}`).join('\n')}\n\nSend /model <number or name> to switch.`)
    }
    const n = /^\d+$/.test(arg) ? Number(arg) : 0
    const q = arg.toLowerCase()
    const pick = n ? models[n - 1] : (models.find((m) => m.id.toLowerCase() === q || m.name.toLowerCase() === q) ?? models.find((m) => m.name.toLowerCase().includes(q)))
    if (!pick) return reply(`No model matches "${arg}". Send /model to see the list.`)
    this.pickModel(paired, pick.id)
    return reply(paired.chatId ? `This chat now uses ${pick.name}.` : `Your next chat starts with ${pick.name}.`)
  }

  stop(): void {
    for (const c of this.live.values()) c.stop()
    this.live.clear()
  }
}

export const channelHub = new ChannelHub()
