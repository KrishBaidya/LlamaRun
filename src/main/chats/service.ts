import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { Chat, ChatAttachment, ChatEvent, ChatMessage, ChatSummary, ContextUsage, ModelContextInfo, ModelInfo, SlashCommand } from '@shared/types'
import { approvals } from '../assistant/approval'
import { builtinInstructions, builtinTools, callBuiltinTool, isBuiltinTool } from '../assistant/builtins'
import { documentBlock } from '../attachments/read'
import { indicator } from '../computer/indicator'
import { computer, computerInstructions, isComputerTool } from '../computer/tools'
import {
  generate,
  GenerationError,
  MAX_TOOL_ROUNDS,
  modelCatalog,
  type HistoryImage,
  type HistoryMessage,
  type ToolBridge,
  type ToolPause
} from '../llm'
import { mcp } from '../mcp/manager'
import { pluginHost } from '../plugins/host'
import { settings } from '../settings'
import { skillStore } from '../skills/store'
import { joinRound } from '../llm/toolRun'
import { COMPACT_SYSTEM, compactionRequest, splitForCompaction, SUMMARY_INTRO, transcriptOf, visibleMessages } from './compact'
import { contextWindowFor, estimateTokens, usageOf } from './context'
import { appendText, finishTool, recalledReplies, replaceText, replyForModel, textOf, toolPart } from './parts'
import { chatStore, titleFrom } from './store'

const FLUSH_MS = 16

/** How one turn runs, for messages a plugin sends (a voice assistant, say). */
export interface TurnOptions {
  /** Instructions for this turn only, e.g. "replies are read aloud". Not shown or saved. */
  system?: string
  /** Offer the MCP tools. Defaults to true. */
  tools?: boolean
}

export interface SendOptions {
  model?: string
  /** Shown on the user message: which plugin sent it, and whether it was spoken. */
  via?: ChatMessage['via']
  turn?: TurnOptions
  /** A new chat created for this message is kept in memory only. */
  ephemeral?: boolean
  attachments?: ChatAttachment[]
  /** The user ran a skill as a /command. */
  skill?: ChatMessage['skill']
}

/** Most images one message may carry. */
export const MAX_IMAGES = 6

/** Commands Llama Run handles itself, ahead of any plugin's. */
export const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: 'compact', description: 'Summarise older messages to free up context', kind: 'builtin', plugin: 'Llama Run', args: '[what to focus on]' },
  { name: 'new', description: 'Start a new chat', kind: 'builtin', plugin: 'Llama Run' }
]

export interface ChatToolOptions {
  /** Offer run_command and web_fetch (see wantsShell). */
  shell?: boolean
  chatId?: string
  /** Offer the computer_* tools (computer use is on and the user typed this turn). */
  computer?: { screenshots: boolean }
}

/**
 * The tools a chat turn offers: Llama Run's own (memory, skills, for typed
 * turns the approved shell and web tools and, when it's on, computer use),
 * the MCP servers' and the plugins'.
 */
export function chatTools(options: ChatToolOptions = {}): ToolBridge | undefined {
  const own = [...builtinTools(options), ...(options.computer ? computer.tools() : [])]
  const ownNames = new Set(own.map((t) => t.name))
  const mcpTools = mcp.tools().filter((t) => !isBuiltinTool(t.name) && !ownNames.has(t.name))
  const pluginTools = pluginHost.modelTools(new Set([...own, ...mcpTools].map((t) => t.name)))
  if (!own.length && !mcpTools.length && !pluginTools.length) return undefined
  const fromPlugins = new Set(pluginTools.map((t) => t.name))
  return {
    tools: [...own, ...mcpTools, ...pluginTools],
    // One desktop, one action at a time; other tools in the same step run together.
    sequential: (name) => isComputerTool(name),
    call: (name, args) =>
      isBuiltinTool(name)
        ? callBuiltinTool(name, args, { chatId: options.chatId })
        : options.computer && isComputerTool(name)
          ? computer.call(name, args, { chatId: options.chatId, screenshots: options.computer.screenshots })
          : fromPlugins.has(name)
            ? pluginHost.callModelTool(name, args)
            : mcp.callTool(name, args)
  }
}

/** Instructions for a turn: memories and skills, computer use, what plugins added, then the turn's own. */
export function systemFor(turn?: string, shell = false, computerOn = false): string | undefined {
  const parts = [builtinInstructions({ shell }), computerOn ? computerInstructions() : '', pluginHost.contextText(), turn?.trim()].filter(Boolean)
  return parts.length ? parts.join('\n\n') : undefined
}

function imageOf(a: ChatAttachment): HistoryImage | null {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(a.dataUrl ?? '')
  return m ? { mediaType: m[1], data: m[2] } : null
}

/** What the model reads for a user turn: the text (as sent) followed by any attached documents. */
function userContent(m: ChatMessage): string {
  const docs = (m.attachments ?? []).filter((a) => a.kind === 'document').map(documentBlock)
  // A skill run as /command: the model gets the skill's instructions (with the arguments filled in).
  const text = m.skill ? m.skill.instructions : (m.prompt ?? m.content)
  return docs.length ? [text, ...docs].filter(Boolean).join('\n\n') : text
}

/**
 * Conversation the model sees: user turns (as sent, with attachments) and
 * completed assistant turns. After a compaction, the summary stands in for
 * everything up to the point it covers.
 */
export function historyFor(messages: ChatMessage[], compaction?: Chat['compaction']): HistoryMessage[] {
  const visible = visibleMessages(messages, compaction)
  const recall = recalledReplies(visible.messages)
  const turns = visible.messages
    .filter((m) => m.role === 'user' || m.status === 'done')
    .map((m): HistoryMessage => {
      if (m.role !== 'user') return { role: m.role, content: replyForModel(m, recall.has(m.id)) }
      const images = (m.attachments ?? []).map(imageOf).filter((i): i is HistoryImage => !!i)
      return { role: 'user', content: userContent(m) || 'See the attached image.', ...(images.length ? { images } : {}) }
    })
    // A reply with nothing to show the model (no text, tools no longer recalled) is left out.
    .filter((m) => m.role === 'user' || m.content)
  if (!visible.summary) return turns
  return [
    { role: 'user', content: `${SUMMARY_INTRO}\n\n${visible.summary}` },
    { role: 'assistant', content: 'Got it. I have the context from that summary and will carry on from there.' },
    ...turns
  ]
}

/**
 * Whether a typed turn gets web_fetch and run_command: in "Install with AI"
 * chats, or when the user asks to install a skill from a link. Other turns
 * never see them, so a model can't wander into the shell unprompted.
 */
export function wantsShell(chat: Pick<Chat, 'installer'>, text: string): boolean {
  if (chat.installer) return true
  return /\binstall/i.test(text) && /\bskills?\b/i.test(text) && /(https?:\/\/|github\.com|gitlab\.com|\.git\b|\b[\w.-]+\/[\w.-]+\b)/i.test(text)
}

async function modelInfo(model: string): Promise<ModelInfo | undefined> {
  const catalog = await modelCatalog().catch(() => null)
  return catalog?.groups.flatMap((g) => g.models).find((m) => m.id === model)
}

/** The context window this model gets (its own size, or the user's override). */
export async function contextFor(model: string): Promise<ModelContextInfo> {
  return contextWindowFor(model, await modelInfo(model), settings.all)
}

/**
 * Whether a turn may operate the computer, and how: only turns the user typed,
 * with computer use on. Screenshots go to local models that can see images
 * (the cloud backend takes text tool results only).
 */
export function computerFor(typed: boolean, info: ModelInfo | undefined, turn?: TurnOptions): ChatToolOptions['computer'] {
  if (!typed || turn?.tools === false || !settings.get('computerUse')) return undefined
  const vision = Boolean(info?.capabilities?.includes('vision'))
  return { screenshots: settings.get('computerScreenshots') !== false && vision && !info?.cloud }
}

/**
 * Runs chat turns: plugin before-hooks -> model (with MCP tools) -> after-hooks.
 * One generation per chat at a time; every change is emitted as a ChatEvent so
 * the overlay and chat window stay in sync when showing the same thread.
 */
class ChatService extends EventEmitter<{ event: [ChatEvent]; changed: [ChatSummary[]] }> {
  private running = new Map<string, AbortController>()
  /** Replies stopped at the tool-round cap, per chat: the message and where it stopped. */
  private paused = new Map<string, { messageId: string; pause: ToolPause; turn?: TurnOptions }>()

  constructor() {
    super()
    chatStore.on('changed', () => this.emit('changed', this.list()))
    indicator.on('stop', (chatId) => this.cancel(chatId))
  }

  list(): ChatSummary[] {
    return chatStore.summaries((id) => this.running.has(id))
  }

  get(id: string): Chat | null {
    return chatStore.get(id) ?? null
  }

  create(model?: string, ephemeral = false): Chat {
    return chatStore.create(model || settings.get('selectedModel'), ephemeral)
  }

  rename(id: string, title: string): void {
    const chat = chatStore.get(id)
    if (!chat) return
    chat.title = title.trim() || chat.title
    chatStore.save(chat, false)
    this.emit('event', { type: 'chat', chat })
  }

  setModel(id: string, model: string): void {
    const chat = chatStore.get(id)
    if (!chat) return
    chat.model = model
    chatStore.save(chat, false)
    this.emit('event', { type: 'chat', chat })
  }

  delete(id: string): void {
    this.cancel(id)
    this.paused.delete(id)
    chatStore.delete(id)
  }

  cancel(id: string): void {
    this.running.get(id)?.abort()
    approvals.cancelChat(id)
  }

  isRunning(id: string): boolean {
    return this.running.has(id)
  }

  async send(chatId: string | null, text: string, model?: string, attachments?: ChatAttachment[]): Promise<string> {
    const compact = !attachments?.length ? /^\/compact(?:\s+([\s\S]*))?$/i.exec(text.trim()) : null
    if (compact) {
      if (!chatId || !chatStore.get(chatId)?.messages.length) throw new Error('Nothing to compact yet')
      await this.compact(chatId, compact[1], true)
      return chatId
    }
    const command = !attachments?.length ? pluginHost.matchCommand(text) : null
    if (command) return this.runCommand(chatId, text, command, model)
    const invoked = skillStore.matchCommand(text)
    if (invoked) {
      const instructions = skillStore.invoke(invoked.skill, invoked.args)
      return this.start(chatId, text.trim(), { model, attachments, skill: { name: invoked.skill.name, instructions } }).chatId
    }
    return this.start(chatId, text, { model, attachments }).chatId
  }

  /** Opens an "Install with AI" chat: the model reads the README and installs it, asking before each command. */
  startInstaller(brief: string): string {
    const chat = this.create()
    chat.installer = true
    return this.start(chat.id, brief, {}).chatId
  }

  /**
   * Everything the chat box's / menu offers: built-in commands, plugin
   * commands and skills, checked in that order when a name is shared.
   */
  commands(): SlashCommand[] {
    const seen = new Set<string>()
    return [...BUILTIN_COMMANDS, ...pluginHost.commands(), ...skillStore.commands()].filter((c) => !seen.has(c.name) && !!seen.add(c.name))
  }

  /**
   * Adds a message a plugin wrote (markdown, HTML or images) to a chat without
   * asking a model. Creates a chat when chatId is null.
   */
  post(chatId: string | null, text: string, plugin: string, attachments?: ChatAttachment[]): { chatId: string; messageId: string } {
    const chat = chatId ? chatStore.get(chatId) : this.create()
    if (!chat) throw new Error(`No chat with id ${chatId}`)
    const message: ChatMessage = { id: randomUUID(), role: 'assistant', content: text, status: 'done', from: { plugin }, createdAt: Date.now() }
    if (attachments?.length) message.attachments = attachments
    if (!chat.messages.length) chat.title = titleFrom(text || plugin)
    chat.messages.push(message)
    chatStore.save(chat)
    this.emit('event', { type: 'message', chatId: chat.id, message: { ...message } })
    return { chatId: chat.id, messageId: message.id }
  }

  /** A typed "/command args" a plugin registered: the plugin answers instead of a model. */
  private runCommand(chatId: string | null, text: string, command: { plugin: string; name: string }, model?: string): string {
    const chat = (chatId ? chatStore.get(chatId) : undefined) ?? this.create(model)
    const user: ChatMessage = { id: randomUUID(), role: 'user', content: text.trim(), status: 'done', createdAt: Date.now() }
    if (!chat.messages.length) chat.title = titleFrom(text)
    chat.messages.push(user)
    chatStore.save(chat)
    this.emit('event', { type: 'chat', chat })
    const args = text.trim().slice(command.name.length + 1).trim()
    const name = pluginHost.pluginName(command.plugin)
    void pluginHost
      .runCommand(command.plugin, command.name, args, chat.id)
      .then((reply) => {
        if (reply) this.post(chat.id, reply, name)
      })
      .catch((err) => this.post(chat.id, `**/${command.name} failed:** ${(err as Error).message}`, name))
    return chat.id
  }

  /** How full the model's context window is for this chat (or an empty one). */
  async contextUsage(chatId: string | null, model: string): Promise<ContextUsage> {
    const chat = chatId ? chatStore.get(chatId) : undefined
    const id = model || chat?.model || settings.get('selectedModel')
    const info = await contextFor(id)
    const tools = chatTools()?.tools ?? []
    return usageOf(info, estimateTokens(historyFor(chat?.messages ?? [], chat?.compaction), systemFor(), tools))
  }

  /** Summarises the chat's older messages now (the /compact command and the menu item). */
  async compact(chatId: string, instructions?: string, manual = true): Promise<void> {
    const chat = chatStore.get(chatId)
    if (!chat) throw new Error(`No chat with id ${chatId}`)
    if (this.running.has(chatId)) throw new Error('Wait for the current response to finish first.')
    const controller = new AbortController()
    this.running.set(chatId, controller)
    this.emit('changed', this.list())
    try {
      await this.compactNow(chat, chat.model || settings.get('selectedModel'), instructions, manual, controller.signal)
    } finally {
      this.running.delete(chatId)
      this.emit('changed', this.list())
    }
  }

  private async compactNow(chat: Chat, model: string, instructions: string | undefined, manual: boolean, signal: AbortSignal): Promise<void> {
    const split = splitForCompaction(chat.messages, settings.get('compactKeepTurns') ?? 4, chat.compaction)
    if (!split) throw new Error('Nothing to compact yet: the conversation is still short.')
    const info = await contextFor(model)
    const system = systemFor()
    const tokensBefore = estimateTokens(historyFor(chat.messages, chat.compaction), system)
    this.emit('event', { type: 'status', chatId: chat.id, status: 'compacting' })
    try {
      const transcript = transcriptOf(split.older, chat.compaction?.summary, Math.floor(info.tokens * 4 * 0.6))
      const summary = (
        await generate(compactionRequest(transcript, instructions), { model, system: COMPACT_SYSTEM, signal, contextTokens: info.tokens })
      ).trim()
      if (signal.aborted) return
      if (!summary) throw new Error('The model returned an empty summary')
      const through = chat.messages[chat.messages.indexOf(split.kept[0]) - 1]
      const compaction = { summary, throughMessageId: through.id, createdAt: Date.now(), tokensBefore, tokensAfter: 0, ...(manual ? { manual } : {}) }
      compaction.tokensAfter = estimateTokens(historyFor(chat.messages, compaction), system)
      chat.compaction = compaction
      chatStore.save(chat, false)
      this.emit('event', { type: 'chat', chat })
    } finally {
      this.emit('event', { type: 'status', chatId: chat.id, status: null })
    }
  }

  /** Compacts first when the next request would pass the model's threshold (auto-compact). */
  private async autoCompact(
    chat: Chat,
    model: string,
    info: ModelContextInfo,
    signal: AbortSignal,
    shell: boolean,
    computerOn?: ChatToolOptions['computer']
  ): Promise<void> {
    if (settings.get('autoCompact') === false) return
    const used = estimateTokens(
      historyFor(chat.messages, chat.compaction),
      systemFor(undefined, shell, Boolean(computerOn)),
      chatTools({ shell, computer: computerOn })?.tools
    )
    if (used < (info.tokens * info.compactAtPercent) / 100) return
    try {
      await this.compactNow(chat, model, undefined, false, signal)
    } catch (err) {
      // Too short to compact, or the summary failed: the history is still cut to fit.
      console.warn(`Auto-compact skipped: ${(err as Error).message}`)
    }
  }

  /**
   * Sends a message and resolves with the finished assistant message. The
   * turn streams to the chat windows like a typed one; follow `event`s for
   * `chatId` to watch it.
   */
  ask(chatId: string | null, text: string, options: SendOptions = {}): { chatId: string; done: Promise<ChatMessage> } {
    return this.start(chatId, text, options)
  }

  private start(chatId: string | null, text: string, options: SendOptions): { chatId: string; done: Promise<ChatMessage> } {
    const content = text.trim()
    const attachments = options.attachments?.filter((a) => a.kind === 'image' || a.kind === 'document') ?? []
    if (!content && !attachments.length) throw new Error('Message is empty')
    if (attachments.filter((a) => a.kind === 'image').length > MAX_IMAGES) throw new Error(`Attach up to ${MAX_IMAGES} images at a time`)
    const existing = chatId ? chatStore.get(chatId) : undefined
    if (chatId && !existing && options.via) throw new Error(`No chat with id ${chatId}`)
    const chat = existing || this.create(options.model, options.ephemeral)
    if (this.running.has(chat.id)) throw new Error('Wait for the current response to finish, or stop it first.')
    if (!chat.model) chat.model = settings.get('selectedModel')
    // A plugin may pick the model per message; typed messages use the chat's model.
    if (existing && options.via && options.model) chat.model = options.model
    this.dropPause(chat)

    const user: ChatMessage = { id: randomUUID(), role: 'user', content, status: 'done', createdAt: Date.now() }
    if (options.via) user.via = options.via
    if (attachments.length) user.attachments = attachments
    if (options.skill) user.skill = options.skill
    if (!chat.messages.length) chat.title = titleFrom(content || attachments[0].name)
    chat.messages.push(user)
    chatStore.save(chat)
    this.emit('event', { type: 'chat', chat })
    return { chatId: chat.id, done: this.run(chat, user, undefined, options.turn, !options.via) }
  }

  retry(chatId: string): void {
    const chat = chatStore.get(chatId)
    if (!chat || this.running.has(chatId)) return
    const idx = chat.messages.map((m) => m.role).lastIndexOf('user')
    if (idx < 0) return
    const user = chat.messages[idx]
    this.dropPause(chat)
    chat.messages = chat.messages.slice(0, idx + 1)
    user.prompt = undefined
    chatStore.save(chat)
    this.emit('event', { type: 'chat', chat })
    void this.run(chat, user, undefined, undefined, !user.via)
  }

  /**
   * Carries on a reply that stopped at the tool-round cap. It runs the tool
   * calls the model had asked for and sends the saved conversation once, so
   * nothing already done is repeated (unlike sending "continue").
   */
  continue(chatId: string): Promise<ChatMessage> | null {
    const chat = chatStore.get(chatId)
    const paused = this.paused.get(chatId)
    if (!chat || !paused || this.running.has(chatId)) return null
    const assistant = chat.messages[chat.messages.length - 1]
    const user = chat.messages.findLast((m) => m.role === 'user')
    if (assistant?.id !== paused.messageId || !user) {
      this.dropPause(chat)
      return null
    }
    this.paused.delete(chatId)
    assistant.toolLimit = undefined
    assistant.note = undefined
    assistant.status = 'streaming'
    return this.run(chat, user, { assistant, pause: paused.pause }, paused.turn, !user.via)
  }

  /** A new message or retry makes a paused run stale. */
  private dropPause(chat: Chat): void {
    const paused = this.paused.get(chat.id)
    if (!paused) return
    this.paused.delete(chat.id)
    const message = chat.messages.find((m) => m.id === paused.messageId)
    if (message) {
      message.toolLimit = undefined
      message.note = undefined
    }
  }

  private async run(
    chat: Chat,
    user: ChatMessage,
    resume?: { assistant: ChatMessage; pause: ToolPause },
    turn?: TurnOptions,
    /** A turn the user typed (not a plugin): it may get the approved shell and web tools (see wantsShell). */
    typed = false
  ): Promise<ChatMessage> {
    const controller = new AbortController()
    this.running.set(chat.id, controller)
    this.emit('changed', this.list())

    const assistant: ChatMessage = resume?.assistant ?? {
      id: randomUUID(),
      role: 'assistant',
      content: '',
      status: 'streaming',
      model: chat.model,
      parts: [],
      createdAt: Date.now()
    }
    // Replies from before parts existed (a paused one being continued) start their list with the text so far.
    assistant.parts ??= assistant.content ? [{ type: 'text', text: assistant.content }] : []
    const parts = assistant.parts
    const prior = assistant.content
    let pause: ToolPause | undefined
    let maxRounds = MAX_TOOL_ROUNDS
    const emitUpdate = (): void => {
      this.emit('event', { type: 'update', chatId: chat.id, message: { ...assistant } })
    }

    let pending = ''
    let timer: NodeJS.Timeout | null = null
    const flush = (): void => {
      if (timer) clearTimeout(timer)
      timer = null
      if (pending) this.emit('event', { type: 'delta', chatId: chat.id, messageId: assistant.id, text: pending })
      pending = ''
    }

    try {
      if (!chat.model) throw new GenerationError('No model selected. Choose one in Settings.', 'NO_MODEL')

      // A continued reply already went through the before-hooks.
      const before = resume
        ? { cancel: false, cancelled_by: undefined, input_text: user.prompt ?? user.content, model: resume.pause.model }
        : await pluginHost.beforeTextGeneration(user.content, chat.model)
      if (before.cancel) {
        assistant.status = 'cancelled'
        assistant.note = before.cancelled_by ? `Cancelled by ${before.cancelled_by}` : 'Cancelled by a plugin'
        chat.messages.push(assistant)
        this.emit('event', { type: 'message', chatId: chat.id, message: { ...assistant } })
        return { ...assistant }
      }
      if (!resume && before.input_text !== user.content) {
        user.prompt = before.input_text
        this.emit('event', { type: 'update', chatId: chat.id, message: { ...user } })
      }
      const model = before.model || chat.model
      assistant.model = model
      const info = await modelInfo(model)
      const context = contextWindowFor(model, info, settings.all)
      const shell = typed && wantsShell(chat, user.prompt ?? user.content)
      const computerOn = computerFor(typed, info, turn)
      maxRounds = computerOn ? Math.min(500, Math.max(MAX_TOOL_ROUNDS, settings.get('computerMaxSteps') || 0)) : MAX_TOOL_ROUNDS
      if (!resume) await this.autoCompact(chat, model, context, controller.signal, shell, computerOn)
      if (controller.signal.aborted) throw new Error('Stopped')

      if (resume) emitUpdate()
      else {
        chat.messages.push(assistant)
        this.emit('event', { type: 'message', chatId: chat.id, message: { ...assistant } })
      }

      const text = await generate(historyFor(chat.messages.slice(0, -1), chat.compaction), {
        model,
        signal: controller.signal,
        tools: turn?.tools === false ? undefined : chatTools({ shell, chatId: chat.id, computer: computerOn }),
        system: systemFor(turn?.system, shell, Boolean(computerOn)),
        maxToolRounds: maxRounds,
        vision: Boolean(info?.capabilities?.includes('vision')),
        // Compaction keeps the history inside the window; this cut is the safety net.
        historyChars: Math.floor(context.tokens * 4 * 0.9),
        contextTokens: context.tokens,
        resume: resume?.pause,
        onPause: (p) => {
          pause = p
        },
        onToken: (t) => {
          assistant.content += t
          appendText(parts, t)
          pending += t
          timer ??= setTimeout(flush, FLUSH_MS)
        },
        onTool: (call) => {
          flush()
          const tool = { name: call.name, server: call.server }
          const part = toolPart(call.id, call.name, call.server, call.args)
          parts.push(part)
          assistant.tools = [...(assistant.tools ?? []), tool]
          this.emit('event', { type: 'tool', chatId: chat.id, messageId: assistant.id, tool, part: { ...part } })
        },
        onToolResult: (id, result, error) => {
          const part = parts.find((p) => p.type === 'tool' && p.id === id)
          if (part?.type !== 'tool') return
          finishTool(part, result, error)
          this.emit('event', { type: 'tool-done', chatId: chat.id, messageId: assistant.id, part: { ...part } })
        }
      })
      flush()

      if (controller.signal.aborted) {
        assistant.status = 'cancelled'
        assistant.note = 'Stopped'
        assistant.content = textOf(parts)
        return { ...assistant }
      }
      // A continued reply carries on after a paragraph break, like a new round.
      assistant.content = joinRound(prior, text, Boolean(prior && text))
      if (pause) {
        // Stopped at the cap; after-hooks run once the reply is finished.
        this.paused.set(chat.id, { messageId: assistant.id, pause, turn })
        assistant.toolLimit = true
        assistant.note = `Paused after ${maxRounds} rounds of tool calls`
        assistant.status = 'done'
        return { ...assistant }
      }
      const after = await pluginHost.afterTextGeneration(before.input_text, assistant.content, model)
      if (after.response_text !== assistant.content) assistant.parts = replaceText(parts, after.response_text)
      assistant.content = after.response_text
      assistant.status = 'done'
    } catch (err) {
      flush()
      // Streamed tokens have no breaks between rounds; the parts do.
      if (parts.length) assistant.content = textOf(parts)
      if (controller.signal.aborted) {
        assistant.status = 'cancelled'
        assistant.note = 'Stopped'
      } else {
        const e = err instanceof GenerationError ? err : new GenerationError((err as Error)?.message ?? String(err))
        assistant.status = 'error'
        assistant.error = e.message
        assistant.errorCode = e.code
        if (!chat.messages.includes(assistant)) {
          chat.messages.push(assistant)
          this.emit('event', { type: 'message', chatId: chat.id, message: { ...assistant } })
        }
      }
    } finally {
      if (timer) clearTimeout(timer)
      computer.endTurn(chat.id)
      this.running.delete(chat.id)
      emitUpdate()
      chatStore.save(chat)
    }
    return { ...assistant }
  }
}

export const chatService = new ChatService()
